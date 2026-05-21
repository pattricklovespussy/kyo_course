const { createClient } = require('@supabase/supabase-js');
const { normalizeHttpUrl } = require('./_utils');

const SUPABASE_URL = normalizeHttpUrl(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'schedule_state';
const SUPABASE_RECORD_ID = process.env.SUPABASE_RECORD_ID || 'main';
const SUPABASE_BOOKINGS_TABLE = process.env.SUPABASE_BOOKINGS_TABLE || 'schedule_bookings';

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

async function loadBookingCounts(){
  if (!supabase) return {};
  try {
    const { data, error } = await supabase
      .from(SUPABASE_BOOKINGS_TABLE)
      .select('course_id');
    if (error) return {};
    return (data || []).reduce((counts, row) => {
      if (!row?.course_id) return counts;
      counts[row.course_id] = (counts[row.course_id] || 0) + 1;
      return counts;
    }, {});
  } catch (err) {
    return {};
  }
}

function applyBookingCounts(schedule, bookingCounts){
  const data = normalizeSchedule(schedule);
  data.courses = data.courses.map(course => {
    const baseUsed = Number.parseInt(course.used, 10);
    const used = Number.isFinite(baseUsed) ? baseUsed : 0;
    const booked = Number.parseInt(bookingCounts?.[course.id], 10);
    return {
      ...course,
      used: used + (Number.isFinite(booked) ? booked : 0)
    };
  });
  return data;
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
        .select('payload')
        .eq('id', SUPABASE_RECORD_ID)
        .limit(1)
        .single();
      if (error && error.code !== 'PGRST116') {
        if (error.code === 'PGRST301' || error.status === 404) {
          return res.status(200).json({ courses: [], sessions: [], updatedAt: Date.now() });
        }
        return res.status(500).json({ error: error.message || error });
      }
      const payload = data?.payload || { courses: [], sessions: [] };
      const bookingCounts = await loadBookingCounts();
      return res.status(200).json(applyBookingCounts(payload, bookingCounts));
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
