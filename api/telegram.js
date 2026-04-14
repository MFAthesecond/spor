const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const SYSTEM_PROMPT = `Sen bir beslenme uzmanısın. Kullanıcı ne yediğini Türkçe olarak açıklayacak.
Her besin maddesini ayrı ayrı analiz et, makrolarını hesapla ve SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir metin ekleme:
{
  "name": "öğünün kısa özet adı (Türkçe, max 60 karakter)",
  "kcal": <toplam kalori, sayı>,
  "protein": <toplam protein gram, sayı>,
  "carb": <toplam karbonhidrat gram, sayı>,
  "fat": <toplam yağ gram, sayı>,
  "items": [
    { "name": "besin adı", "amount": "miktar (örn: 4 adet, 200g)", "kcal": <sayı>, "protein": <sayı>, "carb": <sayı>, "fat": <sayı> }
  ],
  "note": "varsa kısa not (Türkçe, opsiyonel)"
}
Miktar belirtilmemişse makul ortalama porsiyon varsay. Tüm sayısal değerler tam sayı olsun. items toplamı, toplam değerlerle eşleşmeli.`;

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

function extractWeight(text) {
  const patterns = [
    /(?:kilo|ağırlık|tartı)[\s:]*(\d+[.,]\d+|\d+)/i,
    /(\d+[.,]\d+|\d+)\s*kg\b/i,
    /\/kilo\s+(\d+[.,]\d+|\d+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const val = parseFloat(m[1].replace(',', '.'));
      if (val > 20 && val < 500) return val;
    }
  }
  return null;
}

function turkeyTime() {
  return new Date().toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { message } = req.body || {};
  if (!message?.text) return res.status(200).end();

  const chatId = message.chat.id;
  const text   = message.text.trim();
  const date   = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
  const time   = turkeyTime();

  try {
    // /start komutu
    if (text === '/start') {
      await sendMessage(chatId,
        '👋 Merhaba! Ben Furkan\'ın beslenme asistanıyım.\n\n' +
        '*Ne yapabilirim:*\n' +
        '• Ne yediğini yaz → makroları hesaplar & kaydeder\n' +
        '• "kilo 94.5" yaz → kiloyu kaydeder\n\n' +
        '*Örnekler:*\n' +
        '• _sabah 4 yumurta ve 2 dilim ekmek yedim_\n' +
        '• _kilo 93.8_\n' +
        '• _öğle tavuk göğsü 200g pilav 150g_'
      );
      return res.status(200).end();
    }

    // Kilo girişi kontrolü
    const weight = extractWeight(text);
    if (weight !== null) {
      const { error } = await supabase
        .from('weight_logs')
        .upsert({ date, weight_kg: weight }, { onConflict: 'date' });

      if (error) {
        await sendMessage(chatId, `❌ Veritabanı hatası: ${error.message}`);
        return res.status(200).end();
      }

      await sendMessage(chatId, `⚖️ *${weight} kg* kaydedildi!\n📅 ${date}`);
      return res.status(200).end();
    }

    // AI ile öğün analizi
    if (!process.env.OPENAI_KEY) {
      await sendMessage(chatId, '❌ OPENAI_KEY sunucuda tanımlı değil. Vercel env variables\'ı kontrol et.');
      return res.status(200).end();
    }

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        temperature: 0.2,
        max_tokens: 600,
      }),
    });

    if (!openaiRes.ok) {
      await sendMessage(chatId, '❌ AI analizi başarısız oldu. Biraz sonra tekrar dene.');
      return res.status(200).end();
    }

    const aiData  = await openaiRes.json();
    const content = aiData.choices?.[0]?.message?.content || '';

    let meal;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      meal = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      await sendMessage(chatId, '❌ AI yanıtı işlenemedi. Daha açık yazmayı dene (örn: "tavuk 200g pirinç 150g").');
      return res.status(200).end();
    }

    const { error: dbError } = await supabase.from('meals').insert({
      date,
      name:         meal.name || text.slice(0, 60),
      kcal:         Math.round(meal.kcal    || 0),
      protein:      Math.round(meal.protein || 0),
      carb:         Math.round(meal.carb    || 0),
      fat:          Math.round(meal.fat     || 0),
      items:        meal.items || null,
      time,
      ai_generated: true,
    });

    if (dbError) {
      await sendMessage(chatId, `❌ Veritabanı hatası: ${dbError.message}`);
      return res.status(200).end();
    }

    // Yanıt mesajını formatla
    let itemsText = '';
    if (Array.isArray(meal.items) && meal.items.length > 0) {
      itemsText = '\n\n*İçerik:*\n' + meal.items
        .map(i => `• ${i.name} (${i.amount || '?'}): ${i.kcal} kcal`)
        .join('\n');
    }
    const noteText = meal.note ? `\n\n💡 _${meal.note}_` : '';

    await sendMessage(chatId,
      `✅ *${meal.name}* kaydedildi!\n\n` +
      `🔥 ${meal.kcal} kcal\n` +
      `🥩 Protein: ${meal.protein}g\n` +
      `🍚 Karb: ${meal.carb}g\n` +
      `🥑 Yağ: ${meal.fat}g` +
      itemsText +
      noteText
    );

    return res.status(200).end();
  } catch (e) {
    await sendMessage(chatId, `❌ Beklenmeyen hata: ${e.message}`).catch(() => {});
    return res.status(200).end();
  }
};
