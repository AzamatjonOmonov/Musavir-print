// Telegram webhook: /start → raqam so'rash → Mini App tugmasi
const {
  TOKEN, ADMIN_CHAT_ID, SITE_URL, tg, webhookSecret, signPhone, safeEqual, cleanSrc,
} = require('./_lib');

const ASK_PHONE_TEXT =
  "Assalomu alaykum! Musavvir Print botiga xush kelibsiz 📸\n\n" +
  "Esdalik rasmlaringizni sifatli qilib chop etib beramiz. " +
  "Buyurtma berish uchun pastdagi tugma orqali telefon raqamingizni ulashing 👇";

function phoneKeyboard() {
  return {
    keyboard: [[{ text: "📱 Raqamni ulashish", request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function appUrl(uid, phone, src) {
  let url = `${SITE_URL}/?p=${encodeURIComponent(phone)}&s=${signPhone(uid, phone)}`;
  if (src) url += `&src=${src}`;
  return url;
}

function appButton(url) {
  return { inline_keyboard: [[{ text: "🖼 Buyurtma berish", web_app: { url } }]] };
}

// Manbani mijozning bot menyusi tugmasida saqlaymiz (ma'lumotlar bazasisiz)
async function setMenu(uid, url) {
  await tg('setChatMenuButton', {
    chat_id: uid,
    menu_button: { type: 'web_app', text: 'Buyurtma', web_app: { url } },
  });
}

async function readSrc(uid) {
  const r = await tg('getChatMenuButton', { chat_id: uid });
  const url = r.result && r.result.web_app && r.result.web_app.url;
  if (!url) return '';
  try { return cleanSrc(new URL(url).searchParams.get('src')); } catch { return ''; }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('ok');
  if (!TOKEN) return res.status(500).send('BOT_TOKEN yo\'q');
  if (!safeEqual(req.headers['x-telegram-bot-api-secret-token'] || '', webhookSecret())) {
    return res.status(401).send('unauthorized');
  }

  const update = req.body || {};
  try {
    // Bot guruhga qo'shilganda — guruh ID sini ko'rsatadi
    const mcm = update.my_chat_member;
    if (mcm && ['group', 'supergroup'].includes(mcm.chat.type) &&
        ['member', 'administrator'].includes(mcm.new_chat_member.status)) {
      const ready = String(mcm.chat.id) === String(ADMIN_CHAT_ID);
      await tg('sendMessage', {
        chat_id: mcm.chat.id,
        text: ready
          ? "✅ Buyurtmalar shu guruhga keladi."
          : `Salom! Bu guruh ID si: ${mcm.chat.id}\nBuyurtmalar shu yerga kelishi uchun uni Vercel'da ADMIN_CHAT_ID ga yozing.`,
      });
      return res.status(200).send('ok');
    }

    const msg = update.message;
    if (!msg || msg.chat.type !== 'private') return res.status(200).send('ok');
    const uid = msg.from.id;

    if (msg.contact) {
      // Faqat o'z raqamini qabul qilamiz
      if (msg.contact.user_id !== uid) {
        await tg('sendMessage', {
          chat_id: uid,
          text: "Iltimos, o'zingizning raqamingizni tugma orqali ulashing 👇",
          reply_markup: phoneKeyboard(),
        });
        return res.status(200).send('ok');
      }
      let phone = String(msg.contact.phone_number).replace(/[^\d+]/g, '');
      if (!phone.startsWith('+')) phone = '+' + phone;

      const src = await readSrc(uid);
      const url = appUrl(uid, phone, src);
      await setMenu(uid, url);
      await tg('sendMessage', {
        chat_id: uid,
        text: "Rahmat! ✅",
        reply_markup: { remove_keyboard: true },
      });
      await tg('sendMessage', {
        chat_id: uid,
        text:
          "Endi pastdagi tugmani bosing, rasm sonini va manzilingizni yozing. " +
          "Narx darhol hisoblanadi. Buyurtma 50 donadan boshlanadi 👇",
        reply_markup: appButton(url),
      });
      return res.status(200).send('ok');
    }

    // /start reklama → manbani eslab qolamiz
    const m = /^\/start(?:@\w+)?\s+(\S+)/.exec(msg.text || '');
    const src = m ? cleanSrc(m[1]) : '';
    if (src) await setMenu(uid, `${SITE_URL}/?src=${src}`);

    // /start yoki boshqa har qanday xabar — raqam so'raymiz
    await tg('sendMessage', {
      chat_id: uid,
      text: ASK_PHONE_TEXT,
      reply_markup: phoneKeyboard(),
    });
  } catch (e) {
    console.error(e);
  }
  return res.status(200).send('ok');
};
