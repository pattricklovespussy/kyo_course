const { normalizeHttpUrl } = require('./_utils');
const axios = require('axios');

const SUPABASE_URL = normalizeHttpUrl(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'schedule_state';
const SUPABASE_RECORD_ID = process.env.SUPABASE_RECORD_ID || 'main';
const SUPABASE_BOOKINGS_TABLE = process.env.SUPABASE_BOOKINGS_TABLE || 'schedule_bookings';

const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

async function supabaseRest(method, table, { query = '', data = null } = {}) {
  if (!SUPABASE_ENABLED) throw new Error('Supabase not configured');
  const response = await axios.request({
    method,
    url: `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`,
    data,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates'
    },
    validateStatus: () => true
  });
  return response;
}

function normalizeSchedule(payload){
  const data = payload && typeof payload === 'object' ? payload : {};
  return {
    courses: Array.isArray(data.courses) ? data.courses : [],
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    updatedAt: data.updatedAt || Date.now()
  };
}

async function loadBookingCounts(){
  if (!SUPABASE_ENABLED) return {};
  try {
    const response = await supabaseRest('GET', SUPABASE_BOOKINGS_TABLE, { query: 'select=course_id' });
    if (response.status !== 200) return {};
    const data = response.data;
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

  if (!SUPABASE_ENABLED) {
    return res.status(500).json({ error: 'Supabase not configured on server' });
  }

  try {
    if (req.method === 'GET') {
      const response = await supabaseRest('GET', SUPABASE_TABLE, {
        query: `id=eq.${encodeURIComponent(SUPABASE_RECORD_ID)}&select=payload,updated_at`
      });
      if (response.status !== 200) {
        if (response.status === 404) {
          return res.status(200).json({ courses: [], sessions: [], updatedAt: Date.now() });
        }
        return res.status(500).json({ error: `read schedule_state failed (${response.status})`, detail: response.data || null });
      }
      const payload = response.data?.[0]?.payload || { courses: [], sessions: [] };
      const bookingCounts = await loadBookingCounts();
      return res.status(200).json(applyBookingCounts(payload, bookingCounts));
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = req.body || req;
      const payload = normalizeSchedule(body && body.payload ? body.payload : body);
      const response = await supabaseRest('POST', SUPABASE_TABLE, {
        query: 'on_conflict=id',
        data: { id: SUPABASE_RECORD_ID, payload, updated_at: new Date().toISOString() }
      });
      if (response.status < 200 || response.status >= 300) {
        return res.status(500).json({ error: `save schedule_state failed (${response.status})`, detail: response.data || null });
      }
      return res.status(200).json(payload);
    }

    res.setHeader('Allow', 'GET, PUT, POST');
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('api/schedule error', err);
    res.status(500).json({ error: err.message || String(err), detail: err?.response?.data || null });
  }
};
