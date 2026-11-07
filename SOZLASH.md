# Do'kon va admin panelni ishga tushirish

Sahifalar:
- **musavvirprint.uz/dokon** — mijozlar uchun do'kon
- **musavvirprint.uz/admin** — tovar qo'shish va buyurtmalar (parol bilan)

Hozirgi kalkulyator (bosh sahifa) va Telegram bot o'zgarmagan.

## 1. Supabase (baza va rasmlar) — bir marta

1. https://supabase.com → Google bilan kiring → **New project**.
   Nomi: `musavvir-print`, Region: **Frankfurt (eu-central-1)**, parolni saqlab qo'ying.
2. Chap menyu → **SQL Editor** → `supabase/schema.sql` faylidagi hamma matnni joylang → **Run**.
3. **Project Settings → API Keys** (yoki Data API):
   - **Project URL** — `https://xxxx.supabase.co`
   - **Secret key** (`sb_secret_...`). Eski loyihalarda: `service_role` kaliti.
   Bu kalitni hech kimga bermang va saytga yozmang.

## 2. Vercel'ga kalitlarni qo'shish

Vercel → Musavir-print loyihasi → **Settings → Environment Variables**:

| Nomi | Qiymati |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SECRET_KEY` | Secret key |
| `ADMIN_PASSWORD` | Admin panel uchun parol (kamida 10 belgi) |

Environment: **Production** va **Preview** ikkalasini belgilang. Keyin **Deployments → Redeploy**.

`BOT_TOKEN` va `ADMIN_CHAT_ID` allaqachon bor — Preview uchun ham belgilanganini tekshiring, aks holda sinov havolasida buyurtma Telegramga bormaydi.

## Baza ulanmaguncha

Do'kon **namuna tovarlar** bilan ochiladi (sariq yozuv chiqadi). Undan berilgan buyurtma Telegram guruhga
«🧪 SINOV buyurtma» deb keladi — oqimni tekshirish uchun.

## Narxlar qanday hisoblanadi

- 10x15 rasm narxi `api/_lib.js` dagi pog'onalar bo'yicha (kalkulyator bilan bir xil).
- Tovar: variant narxi (yoki asosiy narx) + belgilangan qo'shimchalar.
- Narx har doim serverda bazadan qayta hisoblanadi — mijoz o'zgartira olmaydi.
- Bepul yetkazish: 10x15 rasmlar + to'plamlar ichidagi rasmlar jami 300 tadan.
