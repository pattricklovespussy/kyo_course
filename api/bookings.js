const crypto = require('crypto');
const axios = require('axios');
const { sendChannelMessage } = require('./_discord');
const { normalizeHttpUrl } = require('./_utils');

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

function normalizeBooking(row){
  const slotKey = String(row?.slot_key || '').trim();
  const slotParts = slotKey.split('|');
  const date = slotParts.length >= 4 ? String(slotParts[3] || '').trim() : '';
  return {
    id: row?.id || null,
    userId: row?.user_id || '',
    userName: row?.user_name || '',
    courseId: row?.course_id || '',
    courseName: row?.course_name || '',
    day: Number.parseInt(row?.day, 10) || 1,
    time: String(row?.time || ''),
    date,
    slotKey,
    createdAt: row?.created_at || null
  };
}

function safeText(value, fallback = '-') {
  const text = String(value == null ? '' : value).trim();
  return text || fallback;
}

function formatUserTag(userId) {
  const id = safeText(userId, '');
  return id ? `<@${id}>` : 'N/A';
}

async function loadSchedule(){
  const response = await supabaseRest('GET', SUPABASE_TABLE, {
    query: `id=eq.${encodeURIComponent(SUPABASE_RECORD_ID)}&select=payload`
  });
  if (response.status !== 200) {
    throw new Error(`schedule_state: HTTP ${response.status}`);
  }
  const payload = response.data?.[0]?.payload || { courses: [], sessions: [] };
  return payload;
}

async function countBookings(courseId){
  const response = await supabaseRest('GET', SUPABASE_BOOKINGS_TABLE, {
    query: `course_id=eq.${encodeURIComponent(courseId)}&select=id`
  });
  if (response.status !== 200) {
    throw new Error(`schedule_bookings: HTTP ${response.status}`);
  }
  return Array.isArray(response.data) ? response.data.length : 0;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (!SUPABASE_ENABLED) {
    return res.status(500).json({ error: 'Supabase not configured on server' });
  }

  try {
    if (req.method === 'GET') {
      const userId = String(req.query?.userId || req.query?.user_id || '').trim();
      const courseId = String(req.query?.courseId || req.query?.course_id || '').trim();
      const slotKey = String(req.query?.slotKey || req.query?.slot_key || '').trim();
      const filters = [];
      if (userId) filters.push(`user_id=eq.${encodeURIComponent(userId)}`);
      if (courseId) filters.push(`course_id=eq.${encodeURIComponent(courseId)}`);
      if (slotKey) filters.push(`slot_key=eq.${encodeURIComponent(slotKey)}`);
      filters.push('order=created_at.desc');
      filters.push('select=*');
      const response = await supabaseRest('GET', SUPABASE_BOOKINGS_TABLE, { query: filters.join('&') });
      if (response.status !== 200) return res.status(500).json({ error: `HTTP ${response.status}`, detail: response.data || null });
      return res.status(200).json({ bookings: (response.data || []).map(normalizeBooking) });
    }

    if (req.method === 'POST') {
      const body = req.body || req;
      const userId = String(body.userId || body.user_id || '').trim();
      const userName = String(body.userName || body.user_name || '').trim();
      const courseId = String(body.courseId || body.course_id || '').trim();
      const courseName = String(body.courseName || body.course_name || '').trim();
      const day = Number.parseInt(body.day, 10) || 1;
      const time = String(body.time || '').trim();
      const slotKey = String(body.slotKey || body.slot_key || `${courseId}|${day}|${time}`).trim();

      if (!userId || !courseId || !time || !slotKey) {
        return res.status(400).json({ error: 'Missing booking fields' });
      }

      const schedule = await loadSchedule();
      const course = Array.isArray(schedule.courses) ? schedule.courses.find(c => String(c.id) === courseId) : null;
      if (!course) {
        return res.status(404).json({ error: 'Course not found' });
      }

      if (course.locked) {
        return res.status(403).json({ error: 'Course is locked for booking' });
      }

      const existingByUser = await supabaseRest('GET', SUPABASE_BOOKINGS_TABLE, {
        query: `user_id=eq.${encodeURIComponent(userId)}&slot_key=eq.${encodeURIComponent(slotKey)}&select=id,slot_key`
      });
      if (existingByUser.status === 200 && Array.isArray(existingByUser.data) && existingByUser.data.length) {
        return res.status(409).json({ error: 'You already booked this slot' });
      }

      const currentBookings = await countBookings(courseId);
      const baseUsed = Number.parseInt(course.used, 10);
      const used = Number.isFinite(baseUsed) ? baseUsed : 0;
      const total = Number.parseInt(course.total, 10) || 0;
      if (used + currentBookings >= total) {
        return res.status(409).json({ error: 'No seats left' });
      }

      const row = {
        id: crypto.randomUUID(),
        user_id: userId,
        user_name: userName,
        course_id: courseId,
        course_name: courseName || course.name || '',
        day,
        time,
        slot_key: slotKey,
        created_at: new Date().toISOString()
      };

      const insertRes = await supabaseRest('POST', SUPABASE_BOOKINGS_TABLE, { data: row });
      if (insertRes.status < 200 || insertRes.status >= 300) {
        return res.status(500).json({ error: `HTTP ${insertRes.status}`, detail: insertRes.data || null });
      }
      const booked = normalizeBooking(Array.isArray(insertRes.data) ? insertRes.data[0] : insertRes.data || row);
      await sendChannelMessage(
        `✅ New booking\nUser: ${safeText(booked.userName)} (${formatUserTag(booked.userId)})\nCourse: ${safeText(booked.courseName)}\nSlot: day ${booked.day} - ${safeText(booked.time)}\nBooking ID: ${safeText(booked.id)}`
      );

      return res.status(200).json({ booking: booked });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || req.body?.id || '').trim();
      const userId = String(req.query?.userId || req.body?.userId || '').trim();
      if (!id || !userId) return res.status(400).json({ error: 'Missing id or userId' });
      const isAdminDelete = userId === 'admin' || String(req.query?.admin || req.body?.admin || '').trim() === '1';

      // fetch booking
      const fetchRes = await supabaseRest('GET', SUPABASE_BOOKINGS_TABLE, {
        query: `id=eq.${encodeURIComponent(id)}&select=*`
      });
      if (fetchRes.status !== 200) return res.status(500).json({ error: `HTTP ${fetchRes.status}`, detail: fetchRes.data || null });
      const existing = Array.isArray(fetchRes.data) ? fetchRes.data[0] : null;
      if (!existing) return res.status(404).json({ error: 'Booking not found' });
      if (!isAdminDelete && String(existing.user_id || '') !== userId) return res.status(403).json({ error: 'Not allowed to cancel this booking' });

      const delRes = await supabaseRest('DELETE', SUPABASE_BOOKINGS_TABLE, {
        query: `id=eq.${encodeURIComponent(id)}`
      });
      if (delRes.status < 200 || delRes.status >= 300) return res.status(500).json({ error: `HTTP ${delRes.status}`, detail: delRes.data || null });
      const deleted = Array.isArray(delRes.data) ? delRes.data[0] : delRes.data || existing;
      const canceled = normalizeBooking(deleted);
      await sendChannelMessage(
        `❌ Booking canceled\nUser: ${safeText(canceled.userName)} (${formatUserTag(canceled.userId)})\nCourse: ${safeText(canceled.courseName)}\nSlot: day ${canceled.day} - ${safeText(canceled.time)}\nBooking ID: ${safeText(canceled.id)}`
      );

      return res.status(200).json({ deleted: canceled });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('api/bookings error', err);
    res.status(500).json({ error: err.message || String(err) });
  }
};
