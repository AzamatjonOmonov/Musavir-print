// Do'kon bazasi (Supabase) bilan ishlash. "_" bilan boshlangani uchun endpoint emas.
const crypto = require('crypto');

const SB_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const BUCKET = 'products';

const configured = () => !!(SB_URL && SB_KEY);

function headers(extra = {}) {
  const h = { apikey: SB_KEY, ...extra };
  // Eski "service_role" kaliti JWT bo'ladi — u Authorization'da ham kerak
  if (SB_KEY.startsWith('eyJ')) h.Authorization = `Bearer ${SB_KEY}`;
  return h;
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const h = headers({ 'Content-Type': 'application/json' });
  if (prefer) h.Prefer = prefer;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    console.error('Supabase error', method, path, r.status, data);
    const err = new Error('Baza xatosi');
    err.status = r.status;
    throw err;
  }
  return data;
}

async function uploadImage(buffer, contentType) {
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${name}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': contentType, 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000' }),
    body: buffer,
  });
  if (!r.ok) {
    console.error('Storage error', r.status, await r.text().catch(() => ''));
    throw new Error('Rasm yuklanmadi');
  }
  return `${SB_URL}/storage/v1/object/public/${BUCKET}/${name}`;
}

// ---------- Admin kirish: imzolar ----------
// Imzo kaliti parol + server sirlaridan olinadi: parol almashsa, hamma kirishlar
// bekor bo'ladi; serverdagi sir esa o'g'irlangan tokendan parolni topishga yo'l qo'ymaydi.
function signKey() {
  return crypto.createHash('sha256')
    .update(`admin-sign:${ADMIN_PASSWORD}:${SB_KEY}:${process.env.BOT_TOKEN || ''}`)
    .digest();
}
function sign(payload) {
  return crypto.createHmac('sha256', signKey()).update(payload).digest('hex').slice(0, 48);
}
function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const SESSION_DAYS = 7;
function makeToken() {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return `${exp}.${sign('s:' + exp)}`;
}
function checkToken(token) {
  if (!ADMIN_PASSWORD || !token) return false;
  const [exp, sig] = String(token).split('.');
  if (!/^\d+$/.test(exp || '') || !sig || Number(exp) < Date.now() / 1000) return false;
  return same(sig, sign('s:' + exp));
}
function checkPassword(pw) {
  if (!ADMIN_PASSWORD) return false;
  const a = crypto.createHash('sha256').update(String(pw || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// Telegram'ga yuboriladigan 6 xonali kod. Kodning o'zi hech qayerda saqlanmaydi:
// "challenge" ichida faqat uning imzosi bor.
const CODE_TTL = 5 * 60;
function makeChallenge() {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const nonce = crypto.randomBytes(9).toString('hex');
  const exp = Math.floor(Date.now() / 1000) + CODE_TTL;
  return { code, nonce, challenge: `${exp}.${nonce}.${sign(`c:${exp}:${nonce}:${code}`)}` };
}
// { ok, nonce } yoki { error: 'expired' | 'bad' }
function checkChallenge(challenge, code) {
  const [exp, nonce, sig] = String(challenge || '').split('.');
  if (!/^\d+$/.test(exp || '') || !/^[0-9a-f]{18}$/.test(nonce || '') || !sig) return { error: 'bad' };
  if (Number(exp) < Date.now() / 1000) return { error: 'expired', nonce };
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) return { error: 'bad', nonce };
  return same(sig, sign(`c:${exp}:${nonce}:${c}`)) ? { ok: true, nonce } : { error: 'bad', nonce };
}

// ---------- Kirish urinishlari jurnali ----------
// Bazada saqlanadi (server qayta ishga tushsa ham yo'qolmaydi).
// Baza ulanmagan sinov rejimida — vaqtincha xotirada.
const memEvents = [];
async function logEvent(ip, kind, ref = '') {
  if (!configured()) {
    memEvents.push({ t: Date.now(), ip, kind, ref });
    if (memEvents.length > 5000) memEvents.splice(0, 2500);
    return;
  }
  try {
    await rest('admin_events', { method: 'POST', body: { ip: String(ip).slice(0, 64), kind, ref: String(ref).slice(0, 64) } });
  } catch {
    // jurnal yozilmasa ham kirishni to'xtatmaymiz
  }
}
async function countEvents({ kind, ip, ref, minutes }) {
  const since = Date.now() - minutes * 60 * 1000;
  if (!configured()) {
    return memEvents.filter((e) => e.t >= since && e.kind === kind &&
      (ip == null || e.ip === ip) && (ref == null || e.ref === ref)).length;
  }
  let q = `admin_events?select=id&kind=eq.${encodeURIComponent(kind)}` +
    `&created_at=gte.${encodeURIComponent(new Date(since).toISOString())}&limit=200`;
  if (ip != null) q += `&ip=eq.${encodeURIComponent(ip)}`;
  if (ref != null) q += `&ref=eq.${encodeURIComponent(ref)}`;
  try {
    const rows = await rest(q);
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

// Yuklangan fayl haqiqatan rasm ekanini ichidan tekshirish
function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

// ---------- Tovar ma'lumotini tozalash ----------
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const money = (v) => {
  const n = Math.round(Number(String(v ?? '').replace(/[^\d.]/g, '')));
  return Number.isFinite(n) && n >= 0 && n <= 1e9 ? n : 0;
};
function priceList(arr, max = 20) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => ({ name: str(x && x.name, 60), price: money(x && x.price) }))
    .filter((x) => x.name)
    .slice(0, max);
}
function cleanProduct(p) {
  const out = {
    name: str(p.name, 120),
    category: str(p.category, 40),
    description: str(p.description, 3000),
    price: money(p.price),
    old_price: p.old_price === '' || p.old_price == null ? null : money(p.old_price) || null,
    // Faqat o'z bazamizga yuklangan rasmlar (begona saytga havola qo'yib bo'lmaydi)
    images: Array.isArray(p.images)
      ? p.images.map((u) => str(u, 500))
        .filter((u) => SB_URL && u.startsWith(`${SB_URL}/storage/v1/object/public/${BUCKET}/`) && !/[\s"'<>]/.test(u))
        .slice(0, 8)
      : [],
    variants: priceList(p.variants),
    addons: priceList(p.addons),
    is_bundle: !!p.is_bundle,
    print_qty: Math.max(0, Math.min(100000, Math.round(Number(p.print_qty) || 0))),
    active: p.active !== false,
    sort: Math.max(-9999, Math.min(9999, Math.round(Number(p.sort) || 0))),
  };
  if (!out.name) return { error: 'Tovar nomini yozing' };
  if (!out.price && !out.variants.length) return { error: 'Narx yoki kamida bitta variant kiriting' };
  return { product: out };
}

// Sozlanmagan paytda (sinov havolasida) ko'rinadigan namuna tovarlar
const DEMO_PRODUCTS = [
  {
    id: 'demo-albom', name: 'Fotoalbom', category: 'Albom', price: 0,
    description: "Qattiq muqovali fotoalbom. 10x15 rasmlar uchun cho'ntakli varaqlar.\n\nNamuna tovar — admin paneldan o'zingiz kiritasiz.",
    images: [], variants: [{ name: '100 talik', price: 85000 }, { name: '200 talik', price: 130000 }],
    addons: [{ name: "Muqovaga ism yozish", price: 20000 }], is_bundle: false, active: true, sort: 1,
  },
  {
    id: 'demo-ramka', name: 'Yog\'och ramka', category: 'Ramka', price: 0,
    description: "Devorga ilish yoki stolga qo'yish uchun. Namuna tovar.",
    images: [], variants: [{ name: '10x15', price: 25000 }, { name: 'A5', price: 35000 }, { name: 'A4', price: 45000 }],
    addons: [], is_bundle: false, active: true, sort: 2,
  },
  {
    id: 'demo-polaroid', name: 'Polaroid rasm', category: 'Polaroid', price: 2500, old_price: null,
    description: "Oq hoshiyali polaroid uslubidagi rasm, 1 dona. Namuna tovar.",
    images: [], variants: [], addons: [{ name: 'Laminatsiya', price: 1000 }], is_bundle: false, active: true, sort: 3,
  },
  {
    id: 'demo-tablo', name: 'Laminatsiyali tablo A4', category: 'Laminatsiya', price: 40000,
    description: "Rasm laminatsiya qilinib, qattiq asosga yopishtiriladi. Namuna tovar.",
    images: [], variants: [], addons: [], is_bundle: false, active: true, sort: 4,
  },
  {
    id: 'demo-toplam', name: "Oilaviy to'plam: 100 rasm + albom", category: "To'plam", price: 240000, old_price: 265000,
    description: "100 ta 10x15 rasm, 100 talik albom va muqovaga ism yozish.\n\nRasmlarni buyurtmadan keyin Telegram orqali yuborasiz. Namuna tovar.",
    images: [], variants: [], addons: [{ name: 'Laminatsiyali muqova', price: 15000 }], is_bundle: true, print_qty: 100, active: true, sort: 0,
  },
];

module.exports = {
  configured, rest, uploadImage, makeToken, checkToken, checkPassword, cleanProduct, DEMO_PRODUCTS,
  makeChallenge, checkChallenge, logEvent, countEvents, sniffImage, SESSION_DAYS,
};
