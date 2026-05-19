const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'schedule_state';
const SUPABASE_RECORD_ID = process.env.SUPABASE_RECORD_ID || 'main';

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

function normalizeSchedule(payload){
  const data = payload && typeof payload === 'object' ? payload : {};
  return {
    courses: Array.isArray(data.courses) ? data.courses : [],
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    updatedAt: data.updatedAt || Date.now()
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured on server' });
  }

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from(SUPABASE_TABLE)
        .select('payload, updated_at')
        .eq('id', SUPABASE_RECORD_ID)
        .limit(1)
        .single();
      if (error && error.code !== 'PGRST116') {
        return res.status(500).json({ error: error.message || error });
      }
      const payload = data?.payload || { courses: [], sessions: [] };
      return res.status(200).json(normalizeSchedule(payload));
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = req.body || req;
      const payload = normalizeSchedule(body && body.payload ? body.payload : body);
      const { error } = await supabase
        .from(SUPABASE_TABLE)
        .upsert({ id: SUPABASE_RECORD_ID, payload, updated_at: new Date().toISOString() }, { returning: 'minimal' });
      if (error) return res.status(500).json({ error: error.message || error });
      return res.status(200).json(payload);
    }

    res.setHeader('Allow', 'GET, PUT, POST');
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('api/schedule error', err);
    res.status(500).json({ error: err.message || String(err) });
  }
};
