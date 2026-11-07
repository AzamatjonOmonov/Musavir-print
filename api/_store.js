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
    .map((x) => ({ name: str(x && x.name, 60), name_ru: str(x && x.name_ru, 60), price: money(x && x.price) }))
    .filter((x) => x.name)
    .slice(0, max);
}
// Tanlov guruhlari: [{ name, name_ru, choices: [{ name, name_ru, price }] }]
function optionGroups(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((g) => ({ name: str(g && g.name, 40), name_ru: str(g && g.name_ru, 40), choices: priceList(g && g.choices) }))
    .filter((g) => g.name && g.choices.length)
    .slice(0, 5);
}
function cleanProduct(p) {
  const out = {
    name: str(p.name, 120),
    name_ru: str(p.name_ru, 120),
    category: str(p.category, 40),
    description: str(p.description, 3000),
    description_ru: str(p.description_ru, 3000),
    price: money(p.price),
    old_price: p.old_price === '' || p.old_price == null ? null : money(p.old_price) || null,
    // Faqat o'z bazamizga yuklangan rasmlar (begona saytga havola qo'yib bo'lmaydi)
    images: Array.isArray(p.images)
      ? p.images.map((u) => str(u, 500))
        .filter((u) => SB_URL && u.startsWith(`${SB_URL}/storage/v1/object/public/${BUCKET}/`) && !/[\s"'<>]/.test(u))
        .slice(0, 8)
      : [],
    variants: priceList(p.variants),
    options: optionGroups(p.options),
    addons: priceList(p.addons),
    is_bundle: !!p.is_bundle,
    print_qty: Math.max(0, Math.min(100000, Math.round(Number(p.print_qty) || 0))),
    active: p.active !== false,
    sort: Math.max(-9999, Math.min(9999, Math.round(Number(p.sort) || 0))),
  };
  if (!out.name) return { error: 'Tovar nomini yozing' };
  if (!out.price && !out.variants.length && !out.options.length) {
    return { error: 'Narx, variant yoki tanlov guruhidan kamida bittasini kiriting' };
  }
  return { product: out };
}

// Bitta savat qatorining narxi: (variant yoki asosiy narx) + har bir guruhdan tanlangan + qo'shimchalar
// sel = { v: variant, o: [guruh bo'yicha tanlov], a: [qo'shimchalar] }
function priceItem(p, sel) {
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const groups = Array.isArray(p.options) ? p.options : [];
  const addons = Array.isArray(p.addons) ? p.addons : [];
  const idx = (v, n) => Math.min(Math.max(0, Math.floor(Number(v) || 0)), Math.max(0, n - 1));
  let unit = p.price || 0;
  const parts = [];
  if (variants.length) {
    const v = variants[idx(sel.v, variants.length)];
    unit = v.price;
    parts.push(v.name);
  }
  const o = Array.isArray(sel.o) ? sel.o : [];
  groups.forEach((g, i) => {
    const c = g.choices[idx(o[i], g.choices.length)];
    unit += c.price;
    parts.push(c.name);
  });
  const chosen = [...new Set(Array.isArray(sel.a) ? sel.a.map((i) => Math.floor(Number(i))) : [])]
    .filter((i) => i >= 0 && i < addons.length)
    .map((i) => addons[i]);
  for (const a of chosen) unit += a.price;
  let name = p.name + (parts.length ? ` — ${parts.join(', ')}` : '');
  if (chosen.length) name += ' + ' + chosen.map((a) => a.name).join(', ');
  return { unit, name };
}

// ---------- Sozlamalar: narx kalkulyatorlari va e'lonlar ----------
const DEFAULT_CALCS = [
  {
    id: '10x15', name: '10x15', name_ru: '10x15', on: true, free: true,
    tiers: [
      { from: 1, price: 5000 }, { from: 21, price: 4000 }, { from: 41, price: 3000 }, { from: 50, price: 2000 },
      { from: 100, price: 1800 }, { from: 201, price: 1700 }, { from: 301, price: 1600 }, { from: 501, price: 1500 },
    ],
  },
];
const DEFAULT_ANNOUNCEMENTS = [
  {
    text: "🚚 300 ta rasmdan butun O'zbekiston bo'ylab bepul yetkazamiz",
    text_ru: '🚚 Бесплатная доставка по всему Узбекистану от 300 фото', on: true,
  },
];

function cleanCalcs(arr) {
  if (!Array.isArray(arr)) return { error: "Noto'g'ri ma'lumot" };
  const seen = new Set();
  const out = [];
  for (const c of arr.slice(0, 12)) {
    const name = str(c && c.name, 30);
    if (!name) continue;
    let id = str(c && c.id, 24).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!id) id = crypto.randomBytes(4).toString('hex');
    if (seen.has(id)) id += crypto.randomBytes(2).toString('hex');
    seen.add(id);
    const tiers = (Array.isArray(c.tiers) ? c.tiers : [])
      .map((t) => ({ from: Math.max(1, Math.min(1e6, Math.floor(Number(t && t.from) || 0))), price: money(t && t.price) }))
      .filter((t) => t.from >= 1 && t.price > 0)
      .sort((a, b) => a.from - b.from)
      .filter((t, i, a) => i === 0 || t.from !== a[i - 1].from)
      .slice(0, 20);
    if (!tiers.length) return { error: `«${name}» uchun kamida bitta narx kiriting` };
    tiers[0].from = 1;
    out.push({ id, name, name_ru: str(c.name_ru, 30), on: c.on !== false, free: !!c.free, tiers });
  }
  return { value: out };
}
function cleanAnnouncements(arr) {
  if (!Array.isArray(arr)) return { error: "Noto'g'ri ma'lumot" };
  return {
    value: arr.slice(0, 3)
      .map((a) => ({ text: str(a && a.text, 140), text_ru: str(a && a.text_ru, 140), on: !!(a && a.on) }))
      .filter((a) => a.text),
  };
}
function tierPrice(calc, qty) {
  if (!calc || qty <= 0) return 0;
  let price = 0;
  for (const t of calc.tiers) if (qty >= t.from) price = t.price;
  return price;
}

let settingsCache = null;
let settingsAt = 0;
async function getSettings({ fresh = false } = {}) {
  const defaults = { calculators: DEFAULT_CALCS, announcements: DEFAULT_ANNOUNCEMENTS };
  if (!configured()) return defaults;
  if (!fresh && settingsCache && Date.now() - settingsAt < 15000) return settingsCache;
  try {
    const rows = await rest('settings?select=key,value&key=in.(calculators,announcements)');
    const map = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
    settingsCache = {
      calculators: Array.isArray(map.calculators) && map.calculators.length ? map.calculators : DEFAULT_CALCS,
      announcements: Array.isArray(map.announcements) ? map.announcements : DEFAULT_ANNOUNCEMENTS,
    };
    settingsAt = Date.now();
    return settingsCache;
  } catch {
    return settingsCache || defaults;
  }
}
async function saveSetting(key, value) {
  await rest('settings', {
    method: 'POST', body: { key, value, updated_at: new Date().toISOString() },
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
  settingsCache = null;
}
// 10x15 narxi — bot va asosiy sahifa buyurtmalari uchun
async function printUnitPrice(qty, calcId = '10x15') {
  const { calculators } = await getSettings();
  const calc = calculators.find((c) => c.id === calcId) || calculators[0];
  return tierPrice(calc, qty);
}

// Sozlanmagan paytda (sinov havolasida) ko'rinadigan namuna tovarlar
const DEMO_PRODUCTS = [
  {
    id: 'demo-fotokniga', name: 'Fotokniga (albom)', name_ru: 'Фотокнига', category: 'Albom', price: 90000,
    description: "Rasmlaringizni chiroyli qilib sahifalarga terib, kitob ko'rinishida chop etamiz.\n\nRasmlarni buyurtmadan keyin Telegram orqali yuborasiz. Namuna tovar.",
    description_ru: 'Красиво расставим ваши фото по страницам и напечатаем в виде книги. Фото отправите в Telegram после заказа.',
    images: [], variants: [],
    options: [
      { name: 'Format', name_ru: 'Формат', choices: [{ name: 'A5', name_ru: 'A5', price: 0 }, { name: 'A4', name_ru: 'A4', price: 60000 }] },
      { name: 'Sahifa soni', name_ru: 'Страниц', choices: [
        { name: '10 bet', name_ru: '10 стр.', price: 0 }, { name: '20 bet', name_ru: '20 стр.', price: 40000 }, { name: '30 bet', name_ru: '30 стр.', price: 75000 }] },
      { name: 'Muqova', name_ru: 'Обложка', choices: [{ name: 'Yumshoq', name_ru: 'Мягкая', price: 0 }, { name: 'Qattiq', name_ru: 'Твёрдая', price: 30000 }] },
    ],
    addons: [{ name: 'Muqovaga ism yozish', name_ru: 'Имя на обложке', price: 20000 }], is_bundle: false, active: true, sort: 0,
  },
  {
    id: 'demo-albom', name: 'Fotoalbom', name_ru: 'Фотоальбом', category: 'Albom', price: 0,
    description: "Qattiq muqovali fotoalbom. 10x15 rasmlar uchun cho'ntakli varaqlar.\n\nNamuna tovar — admin paneldan o'zingiz kiritasiz.",
    images: [], variants: [{ name: '100 talik', name_ru: 'на 100 фото', price: 85000 }, { name: '200 talik', name_ru: 'на 200 фото', price: 130000 }],
    options: [], addons: [{ name: 'Muqovaga ism yozish', name_ru: 'Имя на обложке', price: 20000 }], is_bundle: false, active: true, sort: 1,
  },
  {
    id: 'demo-ramka', name: "Yog'och ramka", name_ru: 'Деревянная рамка', category: 'Ramka', price: 0,
    description: "Devorga ilish yoki stolga qo'yish uchun. Namuna tovar.",
    images: [], variants: [{ name: '10x15', price: 25000 }, { name: 'A5', price: 35000 }, { name: 'A4', price: 45000 }],
    options: [], addons: [], is_bundle: false, active: true, sort: 2,
  },
  {
    id: 'demo-toplam', name: "Oilaviy to'plam: 100 rasm + albom", name_ru: 'Семейный набор: 100 фото + альбом', category: "To'plam",
    price: 240000, old_price: 265000,
    description: "100 ta 10x15 rasm, 100 talik albom va muqovaga ism yozish.\n\nRasmlarni buyurtmadan keyin Telegram orqali yuborasiz. Namuna tovar.",
    images: [], variants: [], options: [], addons: [{ name: 'Laminatsiyali muqova', name_ru: 'Ламинированная обложка', price: 15000 }],
    is_bundle: true, print_qty: 100, active: true, sort: 3,
  },
];

module.exports = {
  configured, rest, uploadImage, makeToken, checkToken, checkPassword, cleanProduct, DEMO_PRODUCTS,
  makeChallenge, checkChallenge, logEvent, countEvents, sniffImage, SESSION_DAYS,
  priceItem, getSettings, saveSetting, cleanCalcs, cleanAnnouncements, tierPrice, printUnitPrice,
};
