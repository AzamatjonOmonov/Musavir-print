// Do'kon uchun ochiq ma'lumotlar: GET /api/catalog
// Tovarlar + narx kalkulyatorlari + e'lonlar
const { configured, rest, DEMO_PRODUCTS, getSettings } = require('./_store');

const FIELDS = 'id,name,name_ru,category,description,description_ru,price,old_price,images,variants,options,addons,is_bundle,print_qty,sort';

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  const { calculators, announcements, site, slides } = await getSettings();
  const settings = {
    calculators: calculators.filter((c) => c.on !== false),
    announcements: announcements.filter((a) => a.on),
    site,
    slides: slides.filter((x) => x.on !== false),
  };
  if (!configured()) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, demo: true, products: DEMO_PRODUCTS, reviews: [], ...settings });
  }
  try {
    const [products, reviews] = await Promise.all([
      rest(`products?select=${FIELDS}&active=eq.true&order=sort.asc,created_at.desc&limit=500`),
      rest('reviews?select=id,kind,url,poster,author,note,note_ru,link&active=eq.true&order=sort.asc,created_at.desc&limit=30')
        .catch(() => []),
    ]);
    // Admin o'zgartirsa, saytda ~20 soniyada yangilanadi
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=120');
    return res.status(200).json({ ok: true, products, reviews, ...settings });
  } catch {
    return res.status(502).json({ ok: false, error: "Tovarlar yuklanmadi, qaytadan urinib ko'ring" });
  }
};
