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

  if (req.method === 'GET') {
    const { date, from } = req.query;
    let query = supabase.from('meals').select('*').order('created_at');
    if (date) {
      query = query.eq('date', date);
    } else if (from) {
      query = query.gte('date', from);
    }
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  if (req.method === 'POST') {
    const { name, kcal, protein, carb, fat, items, date, time, ai_generated } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { data, error } = await supabase
      .from('meals')
      .insert({
        date: date || new Date().toISOString().slice(0, 10),
        name,
        kcal: Math.round(kcal || 0),
        protein: Math.round(protein || 0),
        carb: Math.round(carb || 0),
        fat: Math.round(fat || 0),
        items: items || null,
        time: time || null,
        ai_generated: ai_generated || false,
      })
      .select();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data[0]);
  }

  if (req.method === 'DELETE') {
    const { id, date } = req.query;
    if (id) {
      const { error } = await supabase.from('meals').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(204).end();
    }
    if (date) {
      const { error } = await supabase.from('meals').delete().eq('date', date);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(204).end();
    }
    return res.status(400).json({ error: 'id or date query param required' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
