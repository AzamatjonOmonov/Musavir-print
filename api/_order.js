// Bot va sayt buyurtmalari uchun umumiy: tekshirish va guruhga yuborish
const { ADMIN_CHAT_ID, FREE_DELIVERY_FROM, unitPrice, fmt, tg, esc } = require('./_lib');

// qty, manzil va lokatsiyani tekshiradi; xato bo'lsa { error } qaytaradi
function parseOrder(b) {
  const qty = Math.floor(Number(b.qty));
  if (!Number.isFinite(qty) || qty < 1 || qty > 100000) return { error: 'Rasm sonini kiriting' };
  const address = String(b.address || '').trim().slice(0, 300);
  const lat = Number(b.lat);
  const lon = Number(b.lon);
  const hasLoc = b.lat != null && b.lon != null &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
  // Manzil YOKI lokatsiya — bittasi yetarli
  if (address.length < 3 && !hasLoc) {
    return { error: 'Manzilni yozing yoki lokatsiya tugmasini bosing' };
  }
  return { qty, address, lat, lon, hasLoc };
}

// whoLine: '👤 ...' qatori (sayt buyurtmasida bo'lmasligi mumkin)
async function sendOrder({ title, whoLine, phone, order, sourceText }) {
  const { qty, address, lat, lon, hasLoc } = order;
  const price = unitPrice(qty);
  const total = qty * price;
  const free = qty >= FREE_DELIVERY_FROM;

  const lines = [`🆕 <b>${title}</b>`];
  if (whoLine) lines.push(whoLine);
  lines.push(
    `📞 ${esc(phone)}`,
    `🖼 ${qty} ta × ${fmt(price)} = <b>${fmt(total)} so'm</b>`,
    free
      ? '🚚 Yetkazish: <b>bepul</b>'
      : `🚚 Yetkazish: pullik (bepul bo'lishi uchun yana ${FREE_DELIVERY_FROM - qty} ta kerak edi)`,
  );
  if (address.length >= 3) lines.push(`🏠 Manzil: ${esc(address)}`);
  lines.push(`📣 Manba: ${esc(sourceText)}`);
  if (hasLoc) lines.push(`📍 <a href="https://maps.google.com/?q=${lat},${lon}">Xaritada ochish</a>`);

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
  if (!sent.ok) return { ok: false };
  if (hasLoc) {
    await tg('sendLocation', {
      chat_id: chatId, latitude: lat, longitude: lon,
      reply_to_message_id: sent.result.message_id,
    });
  }
  return { ok: true, qty, total };
}

module.exports = { parseOrder, sendOrder };
