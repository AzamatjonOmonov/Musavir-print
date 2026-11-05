// Mini App'dan kelgan buyurtmani tekshirib, yopiq guruhga yuboradi
const {
  TOKEN, ADMIN_CHAT_ID, FREE_DELIVERY_FROM,
  unitPrice, fmt, tg, signPhone, safeEqual, verifyInitData, esc,
} = require('./_lib');

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

  const qty = Math.floor(Number(b.qty));
  if (!Number.isFinite(qty) || qty < 1 || qty > 100000) {
    return res.status(400).json({ ok: false, error: "Rasm sonini kiriting" });
  }
  const address = String(b.address || '').trim().slice(0, 300);
  if (address.length < 3) {
    return res.status(400).json({ ok: false, error: "Manzilni kiriting" });
  }

  const lat = Number(b.lat);
  const lon = Number(b.lon);
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

  const price = unitPrice(qty);
  const total = qty * price;
  const free = qty >= FREE_DELIVERY_FROM;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ');

  const lines = [
    '🆕 <b>Yangi buyurtma</b>',
    `👤 <a href="tg://user?id=${user.id}">${esc(name) || 'Mijoz'}</a>${user.username ? ' (@' + esc(user.username) + ')' : ''}`,
    `📞 ${esc(phone)}`,
    `🖼 ${qty} ta × ${fmt(price)} = <b>${fmt(total)} so'm</b>`,
    free
      ? '🚚 Yetkazish: <b>bepul</b>'
      : `🚚 Yetkazish: pullik (bepul bo'lishi uchun yana ${FREE_DELIVERY_FROM - qty} ta kerak edi)`,
    `🏠 Manzil: ${esc(address)}`,
  ];
  if (hasLoc) {
    lines.push(`📍 <a href="https://maps.google.com/?q=${lat},${lon}">Xaritada ochish</a>`);
  }

  const payload = {
    chat_id: ADMIN_CHAT_ID,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  let sent = await tg('sendMessage', payload);
  // Guruh supergroup'ga aylangan bo'lsa — yangi ID ga qayta yuboramiz
  let chatId = ADMIN_CHAT_ID;
  const migrated = sent.parameters && sent.parameters.migrate_to_chat_id;
  if (!sent.ok && migrated) {
    chatId = migrated;
    console.error('ADMIN_CHAT_ID eskirgan, yangisi:', migrated);
    sent = await tg('sendMessage', { ...payload, chat_id: chatId });
  }
  if (!sent.ok) {
    return res.status(502).json({ ok: false, error: "Xabar yuborilmadi, qaytadan urinib ko'ring" });
  }
  if (hasLoc) {
    await tg('sendLocation', {
      chat_id: chatId,
      latitude: lat,
      longitude: lon,
      reply_to_message_id: sent.result.message_id,
    });
  }

  return res.status(200).json({ ok: true, qty, total });
};
