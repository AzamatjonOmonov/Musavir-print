// Do'kon uchun ochiq tovarlar ro'yxati: GET /api/catalog
const { configured, rest, DEMO_PRODUCTS } = require('./_store');

const FIELDS = 'id,name,category,description,price,old_price,images,variants,addons,is_bundle,print_qty,sort';

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  if (!configured()) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, demo: true, products: DEMO_PRODUCTS });
  }
  try {
    const products = await rest(
      `products?select=${FIELDS}&active=eq.true&order=sort.asc,created_at.desc&limit=500`,
    );
    // Admin o'zgartirsa, saytda ~20 soniyada yangilanadi
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=120');
    return res.status(200).json({ ok: true, products });
  } catch {
    return res.status(502).json({ ok: false, error: "Tovarlar yuklanmadi, qaytadan urinib ko'ring" });
  }
};
