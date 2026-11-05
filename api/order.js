// Telegram Mini App'dan kelgan buyurtma
const {
  TOKEN, ADMIN_CHAT_ID, signPhone, safeEqual, verifyInitData, esc, cleanSrc, srcLabel,
} = require('./_lib');
const { parseOrder, sendOrder } = require('./_order');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  if (!TOKEN || !ADMIN_CHAT_ID) {
    return res.status(500).json({ ok: false, error: 'Bot hali sozlanmagan' });
  }

  const b = req.body || {};
  const user = verifyInitData(b.initData);
  if (!user) return res.status(401).json({ ok: false, error: "Botni qaytadan oching" });

  const phone = String(b.phone || '');
  if (!phone || !safeEqual(signPhone(user.id, phone), b.sig || '')) {
    return res.status(403).json({ ok: false, error: "Avval botda raqamingizni ulashing" });
  }

  const order = parseOrder(b);
  if (order.error) return res.status(400).json({ ok: false, error: order.error });

  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
  const src = cleanSrc(b.src);
  const r = await sendOrder({
    title: 'Yangi buyurtma',
    whoLine: `👤 <a href="tg://user?id=${user.id}">${esc(name) || 'Mijoz'}</a>` +
      (user.username ? ` (@${esc(user.username)})` : ''),
    phone,
    order,
    sourceText: src ? srcLabel(src) : "Bot (to'g'ridan-to'g'ri)",
  });
  if (!r.ok) return res.status(502).json({ ok: false, error: "Xabar yuborilmadi, qaytadan urinib ko'ring" });
  return res.status(200).json(r);
};
