// Saytdan (Instagram ichidagi brauzer va h.k.) kelgan buyurtma
const { TOKEN, ADMIN_CHAT_ID, cleanSrc, srcLabel } = require('./_lib');
const { parseOrder, sendOrder } = require('./_order');

// Oddiy spam himoyasi: bitta IP dan 10 daqiqada 3 tadan ko'p buyurtma yo'q
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 3;
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) { hits.set(ip, list); return true; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

const ALLOWED_HOSTS = /(^|\.)musavvirprint\.uz$|\.vercel\.app$|^localhost$|^127\.0\.0\.1$/;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!TOKEN || !ADMIN_CHAT_ID) {
    return res.status(500).json({ ok: false, error: 'Tizim hali sozlanmagan' });
  }

  // Faqat o'z saytimizdan kelgan so'rovlar
  const origin = req.headers.origin || '';
  let host = '';
  try { host = new URL(origin).hostname; } catch {}
  if (!ALLOWED_HOSTS.test(host)) return res.status(403).json({ ok: false, error: 'Ruxsat yo\'q' });

  const b = req.body || {};
  // Yashirin maydon: odam uni ko'rmaydi, botlar to'ldiradi
  if (b.website) return res.status(200).json({ ok: true });

  const digits = String(b.phone || '').replace(/\D/g, '').replace(/^998/, '');
  if (!/^\d{9}$/.test(digits)) {
    return res.status(400).json({ ok: false, error: "Telefon raqamini to'liq kiriting: +998 va 9 ta raqam" });
  }
  const phone = '+998' + digits;

  const order = parseOrder(b);
  if (order.error) return res.status(400).json({ ok: false, error: order.error });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooMany(ip)) {
    return res.status(429).json({ ok: false, error: "Buyurtmangiz allaqachon qabul qilingan. Tez orada bog'lanamiz." });
  }

  const src = cleanSrc(b.src);
  const r = await sendOrder({
    title: 'Yangi buyurtma (sayt)',
    whoLine: '',
    phone,
    order,
    sourceText: src ? srcLabel(src) : 'Sayt',
  });
  if (!r.ok) return res.status(502).json({ ok: false, error: "Xabar yuborilmadi, qaytadan urinib ko'ring" });
  return res.status(200).json(r);
};
