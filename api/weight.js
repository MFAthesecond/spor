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

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  let supabase;
  try {
    supabase = getSupabase();
  } catch (e) {
    return res.status(503).json({ error: e.message });
  }

  // GET /api/weight          → tüm kayıtlar
  // GET /api/weight?from=    → tarihten itibaren
  // GET /api/weight?date=    → tek gün
  if (req.method === 'GET') {
    const { from, date } = req.query;
    let query = supabase.from('weight_logs').select('*').order('date').order('created_at');
    if (date) query = query.eq('date', date);
    else if (from) query = query.gte('date', from);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // POST /api/weight  → yeni kilo kaydı ekle
  if (req.method === 'POST') {
    const { date, weight_kg, time } = req.body || {};
    if (!weight_kg) return res.status(400).json({ error: 'weight_kg is required' });
    const { data, error } = await supabase
      .from('weight_logs')
      .insert({
        date: date || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }),
        weight_kg: parseFloat(weight_kg),
        time: time || new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }),
      })
      .select();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data[0]);
  }

  // DELETE /api/weight?id=123 → tek kayıt sil
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const { error } = await supabase.from('weight_logs').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
