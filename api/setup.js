// Bir marta ochiladi: https://www.musavvirprint.uz/api/setup
// Webhook'ni shu saytga ulaydi va bot tavsifini o'rnatadi. Qayta ochish zararsiz.
const { TOKEN, SITE_URL, tg, webhookSecret } = require('./_lib');

module.exports = async (req, res) => {
  if (!TOKEN) {
    return res.status(500).json({ ok: false, error: "Vercel'da BOT_TOKEN kiritilmagan" });
  }
  const webhook = await tg('setWebhook', {
    url: `${SITE_URL}/api/bot`,
    secret_token: webhookSecret(),
    allowed_updates: ['message', 'my_chat_member'],
    drop_pending_updates: true,
  });
  await tg('setMyCommands', { commands: [{ command: 'start', description: 'Buyurtma berish' }] });
  await tg('setMyShortDescription', {
    short_description: "Esdalik rasmlaringizni sifatli chop etamiz. Buyurtma 50 donadan, 300 tadan yetkazish bepul.",
  });
  await tg('setMyDescription', {
    description:
      "Musavvir Print — telefoningizdagi esdalik rasmlarni sifatli fotoqog'ozga chop etamiz.\n\n" +
      "Start bosing, raqamingizni ulashing va rasm sonini yozing — narx darhol hisoblanadi.\n" +
      "Buyurtma 50 donadan boshlanadi.",
  });
  const me = await tg('getMe', {});
  res.status(200).json({
    ok: !!webhook.ok,
    bot: me.result ? '@' + me.result.username : null,
    webhook: webhook.description || webhook,
  });
};
