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
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) {
    console.error('TELEGRAM_TOKEN is not set');
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('sendMessage failed:', res.status, err);
  }
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
    const supabase = getSupabase();

    if (text === '/start') {
      await sendMessage(chatId,
        '👋 Merhaba! Ben Furkan\'ın beslenme asistanıyım.\n\n' +
        'Ne yapabilirim:\n' +
        '• Ne yediğini yaz → makroları hesaplar & kaydeder\n' +
        '• "kilo 94.5" yaz → kiloyu kaydeder (günde birden fazla olur)\n' +
        '• /ozet → bugünün makro özeti\n' +
        '• /son7 → son 7 günün ortalaması\n\n' +
        'Örnekler:\n' +
        '• sabah 4 yumurta ve 2 dilim ekmek yedim\n' +
        '• kilo 93.8\n' +
        '• öğle tavuk göğsü 200g pilav 150g'
      );
      return res.status(200).end();
    }

    // /ozet — bugünün makro özeti
    if (text === '/ozet') {
      const { data: meals } = await supabase.from('meals').select('*').eq('date', date);
      const t = (meals || []).reduce((a, m) => {
        a.kcal += m.kcal; a.protein += m.protein; a.carb += m.carb; a.fat += m.fat;
        return a;
      }, { kcal: 0, protein: 0, carb: 0, fat: 0 });

      const targets = { kcal: 2750, protein: 220, carb: 265, fat: 77 };

      await sendMessage(chatId,
        `📊 Bugünün Özeti (${date})\n\n` +
        `🔥 ${t.kcal} / ${targets.kcal} kcal (${targets.kcal - t.kcal > 0 ? targets.kcal - t.kcal + ' kaldı' : 'hedef aşıldı!'})\n` +
        `🥩 Protein: ${t.protein} / ${targets.protein}g\n` +
        `🍚 Karb: ${t.carb} / ${targets.carb}g\n` +
        `🥑 Yağ: ${t.fat} / ${targets.fat}g\n\n` +
        `📝 ${(meals || []).length} öğün kaydedildi`
      );
      return res.status(200).end();
    }

    // /son7 — son 7 günün ortalaması
    if (text === '/son7') {
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

    // Kilo girişi kontrolü
    const weight = extractWeight(text);
    if (weight !== null) {
      const { error } = await supabase
        .from('weight_logs')
        .insert({ date, weight_kg: weight, time });

      if (error) {
        await sendMessage(chatId, `❌ Veritabanı hatası: ${error.message}`);
        return res.status(200).end();
      }

      await sendMessage(chatId, `⚖️ ${weight} kg kaydedildi!\n📅 ${date} ${time}`);
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
    await sendMessage(chatId, `❌ Beklenmeyen hata: ${e.message}`).catch(() => {});
    return res.status(200).end();
  }
};
