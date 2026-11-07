// Do'kon savatidan kelgan buyurtma: POST /api/shop-order
// Narxlar mijozdan emas, bazadan qayta hisoblanadi.
const { TOKEN, ADMIN_CHAT_ID, FREE_DELIVERY_FROM, unitPrice, fmt, tg, esc, cleanSrc, srcLabel } = require('./_lib');
const { configured, rest, DEMO_PRODUCTS } = require('./_store');

const ALLOWED_HOSTS = /(^|\.)musavvirprint\.uz$|\.vercel\.app$|^localhost$|^127\.0\.0\.1$/;

const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= 3) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

function parseAddress(b) {
  const address = String(b.address || '').trim().slice(0, 300);
  const lat = Number(b.lat);
  const lon = Number(b.lon);
  const hasLoc = b.lat != null && b.lon != null && Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
  if (address.length < 3 && !hasLoc) return { error: 'Manzilni yozing yoki lokatsiya tugmasini bosing' };
  return { address, lat: hasLoc ? lat : null, lon: hasLoc ? lon : null, hasLoc };
}

const int = (v, min, max) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};

async function loadProducts(ids) {
  if (!configured()) return DEMO_PRODUCTS.filter((p) => ids.includes(p.id));
  const safe = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!safe.length) return [];
  return rest(`products?select=*&active=eq.true&id=in.(${safe.join(',')})`);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!TOKEN || !ADMIN_CHAT_ID) return res.status(500).json({ ok: false, error: 'Tizim hali sozlanmagan' });
  const fail = (status, error) => res.status(status).json({ ok: false, error });

  let host = '';
  try { host = new URL(req.headers.origin || '').hostname; } catch {}
  if (!ALLOWED_HOSTS.test(host)) return fail(403, "Ruxsat yo'q");

  const b = req.body || {};
  if (b.website) return res.status(200).json({ ok: true }); // bot to'ldirgan yashirin maydon

  const digits = String(b.phone || '').replace(/\D/g, '').replace(/^998/, '');
  if (!/^\d{9}$/.test(digits)) return fail(400, "Telefon raqamini to'liq kiriting: +998 va 9 ta raqam");
  const phone = '+998' + digits;

  const addr = parseAddress(b);
  if (addr.error) return fail(400, addr.error);

  // ---- Savatni qayta hisoblash ----
  const cart = b.cart || {};
  const prints = int(cart.prints, 0, 100000);
  const rawItems = Array.isArray(cart.items) ? cart.items.slice(0, 50) : [];
  let products;
  try {
    products = await loadProducts([...new Set(rawItems.map((x) => String(x && x.id)))]);
  } catch {
    return fail(502, "Buyurtma qabul qilinmadi, qaytadan urinib ko'ring");
  }
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines = [];
  let total = 0;
  let printCount = prints;
  if (prints > 0) {
    const up = unitPrice(prints);
    total += prints * up;
    lines.push({ name: '10x15 rasm chop etish', qty: prints, unit: up, sum: prints * up });
  }
  const missing = [];
  for (const it of rawItems) {
    const p = byId.get(String(it && it.id));
    if (!p) { missing.push(it && it.name ? String(it.name).slice(0, 60) : 'tovar'); continue; }
    const q = int(it.q, 1, 1000);
    const variants = Array.isArray(p.variants) ? p.variants : [];
    const addons = Array.isArray(p.addons) ? p.addons : [];
    let unit = p.price;
    let name = p.name;
    if (variants.length) {
      const v = variants[int(it.v, 0, variants.length - 1)];
      unit = v.price;
      name += ` — ${v.name}`;
    }
    const chosen = [...new Set(Array.isArray(it.a) ? it.a.map((i) => int(i, -1, 99)) : [])]
      .filter((i) => i >= 0 && i < addons.length)
      .map((i) => addons[i]);
    for (const a of chosen) unit += a.price;
    if (chosen.length) name += ' + ' + chosen.map((a) => a.name).join(', ');
    total += unit * q;
    printCount += (Number(p.print_qty) || 0) * q;
    const img = Array.isArray(p.images) && p.images[0] ? String(p.images[0]) : '';
    lines.push({ name, qty: q, unit, sum: unit * q, bundle: !!p.is_bundle, img });
  }
  if (missing.length) {
    return fail(409, `Savatdagi ba'zi tovarlar endi sotuvda yo'q: ${missing.join(', ')}. Savatni yangilang`);
  }
  if (!lines.length) return fail(400, "Savat bo'sh");

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooMany(ip)) return fail(429, "Buyurtmangiz allaqachon qabul qilingan. Tez orada bog'lanamiz.");

  const free = printCount >= FREE_DELIVERY_FROM;
  const src = cleanSrc(b.src);
  const sourceText = src ? srcLabel(src) : "Sayt (do'kon)";

  // ---- Bazaga yozish (raqam olish uchun) ----
  let orderId = null;
  if (configured()) {
    try {
      const [row] = await rest('orders', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          phone, address: addr.address, lat: addr.lat, lon: addr.lon,
          items: lines, total, free_delivery: free, source: sourceText,
        },
      });
      orderId = row && row.id;
    } catch {
      // Baza ishlamasa ham buyurtma Telegramga yetib borsin
    }
  }

  // ---- Telegram xabari ----
  const title = configured()
    ? `🛒 <b>Yangi buyurtma${orderId ? ' #' + orderId : ''} (do'kon)</b>`
    : "🧪 <b>SINOV buyurtma (namuna tovarlar)</b>";
  const msg = [title, `📞 ${esc(phone)}`, ''];
  for (const l of lines) {
    const icon = l.name.startsWith('10x15') ? '🖼' : l.bundle ? '🎁' : '📦';
    msg.push(`${icon} ${esc(l.name)}\n     ${l.qty} × ${fmt(l.unit)} = <b>${fmt(l.sum)}</b>`);
  }
  msg.push(
    '',
    `💰 Jami: <b>${fmt(total)} so'm</b>`,
    free
      ? '🚚 Yetkazish: <b>bepul</b>'
      : `🚚 Yetkazish: pullik (bepul uchun yana ${FREE_DELIVERY_FROM - printCount} ta rasm kerak edi)`,
  );
  if (addr.address.length >= 3) msg.push(`🏠 Manzil: ${esc(addr.address)}`);
  msg.push(`📣 Manba: ${esc(sourceText)}`);
  if (addr.hasLoc) msg.push(`📍 <a href="https://maps.google.com/?q=${addr.lat},${addr.lon}">Xaritada ochish</a>`);

  const payload = { chat_id: ADMIN_CHAT_ID, text: msg.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true };
  let sent = await tg('sendMessage', payload);
  let chatId = ADMIN_CHAT_ID;
  const migrated = sent.parameters && sent.parameters.migrate_to_chat_id;
  if (!sent.ok && migrated) {
    chatId = migrated;
    sent = await tg('sendMessage', { ...payload, chat_id: chatId });
  }
  if (!sent.ok) return fail(502, "Xabar yuborilmadi, qaytadan urinib ko'ring");
  const replyTo = sent.result.message_id;

  // Qaysi tovar ekanini rasmidan tanish uchun: muqova rasmlari + qisqa izoh
  const photos = lines
    .filter((l) => /^https:\/\//.test(l.img || ''))
    .slice(0, 10)
    .map((l) => ({
      type: 'photo',
      media: l.img,
      caption: `${l.name} — ${l.qty} ta`.slice(0, 1000),
    }));
  if (photos.length === 1) {
    await tg('sendPhoto', {
      chat_id: chatId, photo: photos[0].media, caption: photos[0].caption, reply_to_message_id: replyTo,
    });
  } else if (photos.length > 1) {
    await tg('sendMediaGroup', { chat_id: chatId, media: photos, reply_to_message_id: replyTo });
  }

  if (addr.hasLoc) {
    await tg('sendLocation', {
      chat_id: chatId, latitude: addr.lat, longitude: addr.lon, reply_to_message_id: replyTo,
    });
  }
  return res.status(200).json({ ok: true, id: orderId, total, free, prints: printCount });
};
