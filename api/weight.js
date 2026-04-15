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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

  if (req.method === 'GET') {
    const { from } = req.query;
    let query = supabase.from('weight_logs').select('*').order('date');
    if (from) query = query.gte('date', from);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'POST') {
    const { date, weight_kg } = req.body || {};
    if (!weight_kg) return res.status(400).json({ error: 'weight_kg is required' });
    const { data, error } = await supabase
      .from('weight_logs')
      .upsert(
        {
          date: date || new Date().toISOString().slice(0, 10),
          weight_kg: parseFloat(weight_kg),
        },
        { onConflict: 'date' }
      )
      .select();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data[0]);
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
