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

// ---------- Admin kirish tokeni ----------
function sign(payload) {
  return crypto.createHmac('sha256', 'admin:' + ADMIN_PASSWORD).update(payload).digest('hex').slice(0, 40);
}
function makeToken(days = 30) {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  return `${exp}.${sign(String(exp))}`;
}
function checkToken(token) {
  if (!ADMIN_PASSWORD || !token) return false;
  const [exp, sig] = String(token).split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function checkPassword(pw) {
  if (!ADMIN_PASSWORD) return false;
  const a = crypto.createHash('sha256').update(String(pw || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
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
    images: Array.isArray(p.images)
      ? p.images.map((u) => str(u, 500)).filter((u) => /^https:\/\//.test(u)).slice(0, 8)
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
};
