# Furkan — Spor & Beslenme Takip

Kişisel fitness dashboard + Telegram bot. Supabase (veritabanı) + Vercel (hosting + API).

## Kurulum Adımları

### 1. Supabase

1. [supabase.com](https://supabase.com) → New project oluştur
2. Dashboard → SQL Editor → New Query → `schema.sql` içeriğini yapıştır → Run
3. Project Settings → API'dan `Project URL` ve `anon public` key'i kopyala

### 2. Telegram Bot

1. Telegram'da `@BotFather`'a `/newbot` yaz
2. Bot adı ve kullanıcı adı gir
3. Gelen **token**'ı kopyala (örn: `123456789:ABCdef...`)

### 3. GitHub

```bash
cd /Users/furkan/spor
git init
git add .
git commit -m "ilk commit"
# GitHub'da yeni repo oluştur, sonra:
git remote add origin https://github.com/KULLANICI_ADI/spor.git
git push -u origin main
```

### 4. Vercel

1. [vercel.com](https://vercel.com) → New Project → GitHub repo'yu seç
2. **Environment Variables** ekle (Settings → Environment Variables):

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | Supabase proje URL'i |
| `SUPABASE_KEY` | Supabase anon public key |
| `OPENAI_KEY` | OpenAI API key (`sk-...`) |
| `TELEGRAM_TOKEN` | BotFather'dan gelen token |

3. Deploy et → URL'i kopyala (örn: `https://spor-furkan.vercel.app`)

### 5. Telegram Webhook'u Ayarla

Deploy tamamlandıktan sonra terminalde:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_TOKEN>/setWebhook?url=https://spor-furkan.vercel.app/api/telegram"
```

`<TELEGRAM_TOKEN>` ve URL'i kendi değerlerinle değiştir.

### 6. Test

- Browser: `https://spor-furkan.vercel.app` → plan.html açılır
- Makro: `https://spor-furkan.vercel.app/makro.html`
- Telegram'da bot'a `sabah 4 yumurta yedim` yaz → makro.html'de görünür
- Telegram'da `kilo 94.5` yaz → kilo kaydedilir

## Lokal Geliştirme

```bash
npm i -g vercel
vercel dev
# → http://localhost:3000
```

`.env.local` dosyası oluştur (git'e gitmiyor):

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...
OPENAI_KEY=sk-...
TELEGRAM_TOKEN=123456789:ABCdef...
```

## Dosya Yapısı

```
spor/
├── api/
│   ├── meals.js        # GET/POST/DELETE öğün
│   ├── weight.js       # GET/POST kilo
│   ├── analyze.js      # OpenAI makro analiz
│   └── telegram.js     # Telegram webhook
├── public/
│   ├── plan.html       # Spor planı
│   └── makro.html      # Makro takip
├── schema.sql          # Supabase tablo yapısı
├── package.json
└── vercel.json
```
