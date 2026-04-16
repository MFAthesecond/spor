const { createClient } = require('@supabase/supabase-js');

let _supabase;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
      throw new Error('SUPABASE_URL veya SUPABASE_KEY tanımlı değil');
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  }
  return _supabase;
}

const CLASSIFY_PROMPT = `Kullanıcı bir Telegram fitness botuna mesaj yazıyor. Mesajın amacını belirle.
SADECE aşağıdaki JSON'u döndür, başka metin yazma:
{
  "intent": "food" | "weight" | "summary" | "weekly" | "help" | "unknown",
  "weight_kg": <sayı veya null>,
  "food_text": "<yemek açıklaması veya null>"
}

Kurallar:
- "food": Kullanıcı ne yediğini anlatıyor (yumurta yedim, tavuk pilav, kahvaltı yaptım vb.)
- "weight": Kilo bildiriyor (kilom 94, 95.5 kg, tartıldım 93, bugün 94.2 vb.) — weight_kg'a sayıyı yaz
- "summary": Günlük özet istiyor (özet, bugün ne yedim, durum, nasıl gidiyor vb.)
- "weekly": Haftalık özet (son 7 gün, haftalık, bu hafta vb.)
- "help": Yardım istiyor (ne yapabilirsin, komutlar, yardım, nasıl kullanılır vb.)
- "unknown": Hiçbirine uymayan (selam, teşekkür vb.)

food_text: intent food ise, mesajdaki yemek kısmını aynen yaz. Değilse null.
weight_kg: intent weight ise, sayıyı float olarak yaz. Değilse null.`;

const FOOD_PROMPT = `Sen bir beslenme uzmanısın. Kullanıcı ne yediğini Türkçe olarak açıklayacak.
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
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) {
    console.error('TELEGRAM_TOKEN is not set');
    return;
  }
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!r.ok) {
    const err = await r.text();
    console.error('sendMessage failed:', r.status, err);
  }
}

async function callAI(systemPrompt, userText, maxTokens = 300) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      temperature: 0.1,
      max_tokens: maxTokens,
    }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  const content = data.choices?.[0]?.message?.content || '';
  try {
    const match = content.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : content);
  } catch {
    return null;
  }
}

function turkeyDate() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
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
  const date   = turkeyDate();
  const time   = turkeyTime();

  try {
    const supabase = getSupabase();

    // /start her zaman sabit
    if (text.toLowerCase() === '/start') {
      await sendMessage(chatId,
        '👋 Merhaba! Ben Furkan\'ın beslenme asistanıyım.\n\n' +
        'Ne yapabilirim:\n' +
        '• Ne yediğini yaz → makroları hesaplar & kaydeder\n' +
        '• "kilo 94.5" veya "kilom 95" yaz → kiloyu kaydeder\n' +
        '• "özet" veya "bugün ne yedim" → günlük makro özeti\n' +
        '• "haftalık" veya "son 7 gün" → haftalık ortalama\n\n' +
        'Örnekler:\n' +
        '• sabah 4 yumurta ve 2 dilim ekmek yedim\n' +
        '• kilom 93.8\n' +
        '• öğle tavuk göğsü 200g pilav 150g\n' +
        '• özet'
      );
      return res.status(200).end();
    }

    // AI ile mesajın amacını sınıflandır
    if (!process.env.OPENAI_KEY) {
      await sendMessage(chatId, '❌ OPENAI_KEY tanımlı değil.');
      return res.status(200).end();
    }

    const classified = await callAI(CLASSIFY_PROMPT, text, 200);
    if (!classified) {
      await sendMessage(chatId, '❌ Mesajını anlayamadım. Tekrar dener misin?');
      return res.status(200).end();
    }

    const intent = classified.intent;

    // ── WEIGHT ──
    if (intent === 'weight' && classified.weight_kg) {
      const kg = parseFloat(classified.weight_kg);
      if (kg < 20 || kg > 500) {
        await sendMessage(chatId, '❌ Geçersiz kilo değeri.');
        return res.status(200).end();
      }
      const { error } = await supabase
        .from('weight_logs')
        .insert({ date, weight_kg: kg, time });

      if (error) {
        await sendMessage(chatId, `❌ DB hatası: ${error.message}`);
        return res.status(200).end();
      }

      await sendMessage(chatId, `⚖️ ${kg} kg kaydedildi!\n📅 ${date} ${time}`);
      return res.status(200).end();
    }

    // ── SUMMARY ──
    if (intent === 'summary') {
      const { data: meals } = await supabase.from('meals').select('*').eq('date', date);
      const t = (meals || []).reduce((a, m) => {
        a.kcal += m.kcal; a.protein += m.protein; a.carb += m.carb; a.fat += m.fat;
        return a;
      }, { kcal: 0, protein: 0, carb: 0, fat: 0 });

      const targets = { kcal: 2750, protein: 220, carb: 265, fat: 77 };
      const remKcal = targets.kcal - t.kcal;

      let mealsList = '';
      if (meals && meals.length > 0) {
        mealsList = '\n\nÖğünler:\n' + meals.map(m =>
          `• ${m.time || ''} ${m.name} (${m.kcal} kcal)`
        ).join('\n');
      }

      await sendMessage(chatId,
        `📊 Bugünün Özeti (${date})\n\n` +
        `🔥 ${t.kcal} / ${targets.kcal} kcal ${remKcal > 0 ? '(' + remKcal + ' kaldı)' : '(hedef aşıldı!)'}\n` +
        `🥩 Protein: ${t.protein} / ${targets.protein}g\n` +
        `🍚 Karb: ${t.carb} / ${targets.carb}g\n` +
        `🥑 Yağ: ${t.fat} / ${targets.fat}g\n` +
        `📝 ${(meals || []).length} öğün` +
        mealsList
      );
      return res.status(200).end();
    }

    // ── WEEKLY ──
    if (intent === 'weekly') {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 7);
      const fromStr = fromDate.toISOString().slice(0, 10);
      const { data: meals } = await supabase.from('meals').select('*').gte('date', fromStr);
      const { data: weights } = await supabase.from('weight_logs').select('*').gte('date', fromStr);

      const byDate = {};
      (meals || []).forEach(m => {
        if (!byDate[m.date]) byDate[m.date] = { kcal: 0, protein: 0, carb: 0, fat: 0 };
        byDate[m.date].kcal += m.kcal;
        byDate[m.date].protein += m.protein;
        byDate[m.date].carb += m.carb;
        byDate[m.date].fat += m.fat;
      });

      const days = Object.keys(byDate).length || 1;
      const avg = {
        kcal:    Math.round(Object.values(byDate).reduce((a, d) => a + d.kcal, 0) / days),
        protein: Math.round(Object.values(byDate).reduce((a, d) => a + d.protein, 0) / days),
        carb:    Math.round(Object.values(byDate).reduce((a, d) => a + d.carb, 0) / days),
        fat:     Math.round(Object.values(byDate).reduce((a, d) => a + d.fat, 0) / days),
      };

      let weightText = '';
      if (weights && weights.length > 0) {
        const wVals = weights.map(w => parseFloat(w.weight_kg));
        const wAvg  = (wVals.reduce((a, b) => a + b, 0) / wVals.length).toFixed(1);
        const wMin  = Math.min(...wVals).toFixed(1);
        const wMax  = Math.max(...wVals).toFixed(1);
        weightText = `\n\n⚖️ Kilo: ort ${wAvg} kg (${wMin}–${wMax})`;
      }

      await sendMessage(chatId,
        `📈 Son 7 Gün Ortalaması\n\n` +
        `🔥 ${avg.kcal} kcal/gün\n` +
        `🥩 Protein: ${avg.protein}g\n` +
        `🍚 Karb: ${avg.carb}g\n` +
        `🥑 Yağ: ${avg.fat}g\n` +
        `📝 ${days} gün veri var` +
        weightText
      );
      return res.status(200).end();
    }

    // ── HELP ──
    if (intent === 'help') {
      await sendMessage(chatId,
        '📖 Kullanım:\n\n' +
        '• Yemek yaz → AI makroları hesaplar ve kaydeder\n' +
        '• "kilo 94.5" → kilo kaydeder\n' +
        '• "özet" → bugünün durumu\n' +
        '• "haftalık" → son 7 gün ortalaması'
      );
      return res.status(200).end();
    }

    // ── UNKNOWN (selam vb.) ──
    if (intent === 'unknown') {
      await sendMessage(chatId,
        '👋 Ne yediğini yaz kaydedeyim, veya "özet" / "kilo 94.5" yazabilirsin.'
      );
      return res.status(200).end();
    }

    // ── FOOD ──
    const foodText = classified.food_text || text;
    const meal = await callAI(FOOD_PROMPT, foodText, 600);

    if (!meal || !meal.name) {
      await sendMessage(chatId, '❌ Yemeği analiz edemedim. Daha açık yazmayı dene.');
      return res.status(200).end();
    }

    const { error: dbError } = await supabase.from('meals').insert({
      date,
      name:         meal.name,
      kcal:         Math.round(meal.kcal    || 0),
      protein:      Math.round(meal.protein || 0),
      carb:         Math.round(meal.carb    || 0),
      fat:          Math.round(meal.fat     || 0),
      items:        meal.items || null,
      time,
      ai_generated: true,
    });

    if (dbError) {
      await sendMessage(chatId, `❌ DB hatası: ${dbError.message}`);
      return res.status(200).end();
    }

    let itemsText = '';
    if (Array.isArray(meal.items) && meal.items.length > 0) {
      itemsText = '\n\nİçerik:\n' + meal.items
        .map(i => `• ${i.name} (${i.amount || '?'}): ${i.kcal} kcal`)
        .join('\n');
    }
    const noteText = meal.note ? `\n\n💡 ${meal.note}` : '';

    await sendMessage(chatId,
      `✅ ${meal.name} kaydedildi!\n\n` +
      `🔥 ${meal.kcal} kcal\n` +
      `🥩 Protein: ${meal.protein}g\n` +
      `🍚 Karb: ${meal.carb}g\n` +
      `🥑 Yağ: ${meal.fat}g` +
      itemsText +
      noteText
    );

    return res.status(200).end();
  } catch (e) {
    console.error('Telegram handler error:', e);
    await sendMessage(chatId, `❌ Hata: ${e.message}`).catch(() => {});
    return res.status(200).end();
  }
};
