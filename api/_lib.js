// Umumiy yordamchi funksiyalar (Vercel "_" bilan boshlangan faylni endpoint qilmaydi)
const crypto = require('crypto');

const TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '';
const SITE_URL = (process.env.SITE_URL || 'https://www.musavvirprint.uz').replace(/\/$/, '');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'AzizaxonOmonova';
const FREE_DELIVERY_FROM = 300;

// 10x15 narxlari (1 dona) — saytdagi bilan bir xil bo'lishi shart
function unitPrice(qty) {
  if (qty <= 0) return 0;
  if (qty <= 20) return 5000;
  if (qty <= 40) return 4000;
  if (qty < 50) return 3000;
  if (qty < 100) return 2000;
  if (qty <= 200) return 1800;
  if (qty <= 300) return 1700;
  if (qty <= 500) return 1600;
  return 1500;
}

const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!data.ok) console.error('Telegram API error', method, data);
  return data;
}

// Webhook so'rovi haqiqatan Telegram'dan kelganini tekshirish uchun maxfiy kalit
function webhookSecret() {
  return crypto.createHash('sha256').update('webhook:' + TOKEN).digest('hex').slice(0, 48);
}

// Raqamni foydalanuvchi ID bilan birga imzolash (Mini App havolasiga qo'yiladi)
function signPhone(uid, phone) {
  return crypto.createHmac('sha256', TOKEN).update(`${uid}:${phone}`).digest('hex').slice(0, 32);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Telegram Mini App initData tekshiruvi; to'g'ri bo'lsa user obyektini qaytaradi
function verifyInitData(initData, maxAgeSec = 24 * 3600) {
  if (!initData || !TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const checkString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
  if (!safeEqual(calc, hash)) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    return JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

module.exports = {
  TOKEN, ADMIN_CHAT_ID, SITE_URL, ADMIN_USERNAME, FREE_DELIVERY_FROM,
  unitPrice, fmt, tg, webhookSecret, signPhone, safeEqual, verifyInitData, esc,
};
