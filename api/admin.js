// Admin panel uchun yagona endpoint: POST /api/admin { action, token, ... }
const {
  configured, rest, uploadImage, makeToken, checkToken, checkPassword, cleanProduct,
} = require('./_store');

const STATUSES = ['yangi', 'ishlanmoqda', 'yuborildi', 'bekor'];
const UUID = /^[0-9a-f-]{36}$/i;

// Parolni taxmin qilishdan himoya: bitta IP dan 15 daqiqada 8 ta xato urinish
const fails = new Map();
function blocked(ip) {
  const now = Date.now();
  const list = (fails.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  fails.set(ip, list);
  return list.length >= 8;
}
function addFail(ip) {
  fails.set(ip, [...(fails.get(ip) || []), Date.now()]);
  if (fails.size > 5000) fails.clear();
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const b = req.body || {};
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const fail = (status, error) => res.status(status).json({ ok: false, error });

  if (!process.env.ADMIN_PASSWORD) return fail(500, "Vercel'da ADMIN_PASSWORD kiritilmagan");

  if (b.action === 'login') {
    if (blocked(ip)) return fail(429, "Ko'p urinish bo'ldi. 15 daqiqadan keyin qayta urinib ko'ring");
    if (!checkPassword(b.password)) {
      addFail(ip);
      return fail(401, "Parol noto'g'ri");
    }
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
        const url = await uploadImage(buf, type);
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
