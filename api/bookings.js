const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { sendChannelMessage } = require('./_discord');

function normalizeHttpUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

const SUPABASE_URL = normalizeHttpUrl(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'schedule_state';
const SUPABASE_RECORD_ID = process.env.SUPABASE_RECORD_ID || 'main';
const SUPABASE_BOOKINGS_TABLE = process.env.SUPABASE_BOOKINGS_TABLE || 'schedule_bookings';

const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

function normalizeBooking(row){
  return {
    id: row?.id || null,
    userId: row?.user_id || '',
    userName: row?.user_name || '',
    courseId: row?.course_id || '',
    courseName: row?.course_name || '',
    day: Number.parseInt(row?.day, 10) || 1,
    time: String(row?.time || ''),
    slotKey: row?.slot_key || '',
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
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select('payload')
    .eq('id', SUPABASE_RECORD_ID)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  const payload = data?.payload || { courses: [], sessions: [] };
  return payload;
}

async function countBookings(courseId){
  const { count, error } = await supabase
    .from(SUPABASE_BOOKINGS_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('course_id', courseId);
  if (error) throw error;
  return Number(count || 0);
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured on server' });
  }

  try {
    if (req.method === 'GET') {
      const userId = String(req.query?.userId || req.query?.user_id || '').trim();
      const courseId = String(req.query?.courseId || req.query?.course_id || '').trim();
      const slotKey = String(req.query?.slotKey || req.query?.slot_key || '').trim();
      let query = supabase
        .from(SUPABASE_BOOKINGS_TABLE)
        .select('*')
        .order('created_at', { ascending: false });
      if (userId) query = query.eq('user_id', userId);
      if (courseId) query = query.eq('course_id', courseId);
      if (slotKey) query = query.eq('slot_key', slotKey);
      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message || error });
      return res.status(200).json({ bookings: (data || []).map(normalizeBooking) });
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

      const existingByUser = await supabase
        .from(SUPABASE_BOOKINGS_TABLE)
        .select('id, slot_key')
        .eq('user_id', userId)
        .eq('slot_key', slotKey)
        .limit(1)
        .single();
      if (!existingByUser.error && existingByUser.data) {
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

      const { data, error } = await supabase
        .from(SUPABASE_BOOKINGS_TABLE)
        .insert(row)
        .select('*')
        .single();
      if (error) return res.status(500).json({ error: error.message || error });

      const booked = normalizeBooking(data);
      await sendChannelMessage(
        `✅ New booking\nUser: ${safeText(booked.userName)} (${formatUserTag(booked.userId)})\nCourse: ${safeText(booked.courseName)}\nSlot: day ${booked.day} - ${safeText(booked.time)}\nBooking ID: ${safeText(booked.id)}`
      );

      return res.status(200).json({ booking: booked });
    }

      if (req.method === 'DELETE') {
        const id = String(req.query?.id || req.body?.id || '').trim();
        const userId = String(req.query?.userId || req.body?.userId || '').trim();
        if (!id || !userId) return res.status(400).json({ error: 'Missing id or userId' });

        // fetch booking
        const { data: existing, error: fetchErr } = await supabase
          .from(SUPABASE_BOOKINGS_TABLE)
          .select('*')
          .eq('id', id)
          .limit(1)
          .single();
        if (fetchErr && fetchErr.code === 'PGRST116') return res.status(404).json({ error: 'Booking not found' });
        if (fetchErr) return res.status(500).json({ error: fetchErr.message || fetchErr });
        if (!existing) return res.status(404).json({ error: 'Booking not found' });
        if (String(existing.user_id || '') !== userId) return res.status(403).json({ error: 'Not allowed to cancel this booking' });

        const { data: deleted, error: delErr } = await supabase
          .from(SUPABASE_BOOKINGS_TABLE)
          .delete()
          .eq('id', id)
          .select('*')
          .single();
        if (delErr) return res.status(500).json({ error: delErr.message || delErr });
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
