function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text is required' });

  if (!process.env.OPENAI_KEY) {
    return res.status(503).json({ error: 'OPENAI_KEY sunucuda tanımlı değil' });
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
    const err = await openaiRes.json().catch(() => ({}));
    return res.status(openaiRes.status).json({ error: err?.error?.message || 'OpenAI API hatası' });
  }

  const data = await openaiRes.json();
  const content = data.choices?.[0]?.message?.content || '';

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    return res.json(parsed);
  } catch {
    return res.status(500).json({ error: 'AI yanıtı JSON\'a çevrilemedi' });
  }
};
