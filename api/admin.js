// Admin panel uchun yagona endpoint: POST /api/admin { action, token, ... }
// Kirish 2 bosqichli: parol → Telegram guruhga kelgan 6 xonali kod.
const {
  configured, rest, uploadImage, makeToken, checkToken, checkPassword, cleanProduct,
  makeChallenge, checkChallenge, logEvent, countEvents, sniffImage,
} = require('./_store');
const { ADMIN_CHAT_ID, tg, esc } = require('./_lib');

const STATUSES = ['yangi', 'ishlanmoqda', 'yuborildi', 'bekor'];
const UUID = /^[0-9a-f-]{36}$/i;
const ALLOWED_HOSTS = /(^|\.)musavvirprint\.uz$|\.vercel\.app$|^localhost$|^127\.0\.0\.1$/;

// Cheklovlar (15 daqiqa ichida)
const WINDOW_MIN = 15;
const MAX_FAILS_PER_IP = 6;      // bitta IP dan noto'g'ri parol
const MAX_FAILS_TOTAL = 20;      // hamma IP lardan birga (tarqoq hujumga qarshi)
const MAX_CODES_TOTAL = 6;       // Telegramga yuboriladigan kodlar
const MAX_CODE_TRIES = 5;        // bitta kod uchun xato urinish

function clientIp(req) {
  return String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || '')
    .trim().slice(0, 64) || 'unknown';
}
function notify(text) {
  if (!ADMIN_CHAT_ID || !process.env.BOT_TOKEN) return Promise.resolve();
  return tg('sendMessage', { chat_id: ADMIN_CHAT_ID, text, parse_mode: 'HTML' }).catch(() => {});
}

async function loginBlocked(ip) {
  const [mine, all] = await Promise.all([
    countEvents({ kind: 'fail', ip, minutes: WINDOW_MIN }),
    countEvents({ kind: 'fail', minutes: WINDOW_MIN }),
  ]);
  return mine >= MAX_FAILS_PER_IP || all >= MAX_FAILS_TOTAL;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const fail = (status, error) => res.status(status).json({ ok: false, error });

  // Faqat o'z saytimizdagi sahifadan
  let host = '';
  try { host = new URL(req.headers.origin || '').hostname; } catch {}
  if (!ALLOWED_HOSTS.test(host)) return fail(403, "Ruxsat yo'q");

  const b = req.body || {};
  const ip = clientIp(req);

  if (!process.env.ADMIN_PASSWORD) return fail(500, "Vercel'da ADMIN_PASSWORD kiritilmagan");
  if (process.env.ADMIN_PASSWORD.length < 10) {
    return fail(500, "ADMIN_PASSWORD juda qisqa: kamida 10 belgi bo'lsin (Vercel sozlamalarida almashtiring)");
  }

  // ---- 1-bosqich: parol ----
  if (b.action === 'login') {
    if (await loginBlocked(ip)) {
      return fail(429, "Ko'p noto'g'ri urinish bo'ldi. 15 daqiqadan keyin qayta urinib ko'ring");
    }
    if (!checkPassword(b.password)) {
      await logEvent(ip, 'fail');
      const mine = await countEvents({ kind: 'fail', ip, minutes: WINDOW_MIN });
      if (mine === MAX_FAILS_PER_IP) {
        await notify(`⚠️ <b>Admin panel</b>: ${MAX_FAILS_PER_IP} marta noto'g'ri parol kiritildi.\nIP: ${esc(ip)}\n15 daqiqaga bloklandi.`);
      }
      return fail(401, "Parol noto'g'ri");
    }
    if (!ADMIN_CHAT_ID || !process.env.BOT_TOKEN) return fail(500, "Telegram sozlanmagan: kod yuborib bo'lmaydi");
    if (await countEvents({ kind: 'code_sent', minutes: WINDOW_MIN }) >= MAX_CODES_TOTAL) {
      return fail(429, "Ko'p kod so'raldi. 15 daqiqadan keyin qayta urinib ko'ring");
    }
    const { code, nonce, challenge } = makeChallenge();
    const sent = await tg('sendMessage', {
      chat_id: ADMIN_CHAT_ID,
      parse_mode: 'HTML',
      text: `🔐 Admin panelga kirish kodi: <code>${code}</code>\n5 daqiqa amal qiladi. IP: ${esc(ip)}\n\n` +
        "Agar hozir siz kirmayotgan bo'lsangiz, kodni hech kimga bermang va admin parolini almashtiring.",
    }).catch(() => ({}));
    if (!sent || !sent.ok) return fail(502, "Kod Telegramga yuborilmadi, qaytadan urinib ko'ring");
    await logEvent(ip, 'code_sent', nonce);
    return res.status(200).json({ ok: true, step: 'code', challenge });
  }

  // ---- 2-bosqich: Telegramdagi kod ----
  if (b.action === 'verify') {
    if (await loginBlocked(ip)) {
      return fail(429, "Ko'p noto'g'ri urinish bo'ldi. 15 daqiqadan keyin qayta urinib ko'ring");
    }
    const r = checkChallenge(b.challenge, b.code);
    if (r.nonce && await countEvents({ kind: 'code_fail', ref: r.nonce, minutes: 10 }) >= MAX_CODE_TRIES) {
      return fail(429, "Kod ko'p marta xato kiritildi. Parolni qaytadan kiriting");
    }
    if (r.error === 'expired') return fail(401, "Kodning vaqti o'tdi. Parolni qaytadan kiriting");
    if (r.error) {
      await logEvent(ip, 'code_fail', r.nonce || '');
      await logEvent(ip, 'fail');
      return fail(401, "Kod noto'g'ri");
    }
    if (await countEvents({ kind: 'code_used', ref: r.nonce, minutes: 10 }) > 0) {
      return fail(401, "Bu kod ishlatilgan. Parolni qaytadan kiriting");
    }
    await logEvent(ip, 'code_used', r.nonce);
    await notify(`✅ Admin panelga kirildi. IP: ${esc(ip)}`);
    return res.status(200).json({ ok: true, token: makeToken(), configured: configured() });
  }

  if (!checkToken(b.token)) return fail(401, 'Qaytadan kiring');
  if (!configured()) {
    return fail(503, "Baza hali ulanmagan: Vercel'da SUPABASE_URL va SUPABASE_SECRET_KEY kiritilishi kerak");
  }

  try {
    switch (b.action) {
      case 'products.list': {
        const products = await rest('products?select=*&order=sort.asc,created_at.desc&limit=1000');
        return res.status(200).json({ ok: true, products });
      }

      case 'products.save': {
        const c = cleanProduct(b.product || {});
        if (c.error) return fail(400, c.error);
        let row;
        if (b.id) {
          if (!UUID.test(b.id)) return fail(400, "Noto'g'ri tovar");
          [row] = await rest(`products?id=eq.${b.id}`, {
            method: 'PATCH', body: c.product, prefer: 'return=representation',
          });
        } else {
          [row] = await rest('products', { method: 'POST', body: c.product, prefer: 'return=representation' });
        }
        return res.status(200).json({ ok: true, product: row });
      }

      case 'products.toggle': {
        if (!UUID.test(b.id || '')) return fail(400, "Noto'g'ri tovar");
        const [row] = await rest(`products?id=eq.${b.id}`, {
          method: 'PATCH', body: { active: !!b.active }, prefer: 'return=representation',
        });
        return res.status(200).json({ ok: true, product: row });
      }

      case 'products.delete': {
        if (!UUID.test(b.id || '')) return fail(400, "Noto'g'ri tovar");
        await rest(`products?id=eq.${b.id}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }

      case 'upload': {
        const type = String(b.type || '');
        if (!/^image\/(jpeg|png|webp)$/.test(type)) return fail(400, 'Faqat JPG, PNG yoki WEBP rasm');
        const buf = Buffer.from(String(b.data || ''), 'base64');
        if (!buf.length || buf.length > 3.5 * 1024 * 1024) return fail(400, 'Rasm juda katta');
        const real = sniffImage(buf);
        if (!real) return fail(400, 'Bu fayl rasm emas');
        const url = await uploadImage(buf, real);
        return res.status(200).json({ ok: true, url });
      }

      case 'orders.list': {
        const st = STATUSES.includes(b.status) ? `&status=eq.${b.status}` : '';
        const orders = await rest(`orders?select=*&order=id.desc&limit=200${st}`);
        return res.status(200).json({ ok: true, orders });
      }

      case 'orders.status': {
        const id = Math.floor(Number(b.id));
        if (!id || !STATUSES.includes(b.status)) return fail(400, "Noto'g'ri so'rov");
        const [row] = await rest(`orders?id=eq.${id}`, {
          method: 'PATCH', body: { status: b.status }, prefer: 'return=representation',
        });
        return res.status(200).json({ ok: true, order: row });
      }

      default:
        return fail(400, "Noma'lum amal");
    }
  } catch (e) {
    return fail(502, e.message || 'Xatolik');
  }
};
