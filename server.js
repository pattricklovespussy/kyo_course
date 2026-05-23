const express = require('express');
const axios = require('axios');
const cookieSession = require('cookie-session');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const WEB_PORT = process.env.WEB_PORT || 4000;

const DISCORD_CLIENT_ID = String(process.env.DISCORD_CLIENT_ID || '').trim();
const DISCORD_CLIENT_SECRET = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
const DISCORD_REDIRECT_URI = String(process.env.DISCORD_REDIRECT_URI || `http://localhost:${WEB_PORT}/auth/discord/callback`).trim();
const DISCORD_BOT_TOKEN = String(process.env.DISCORD_BOT_TOKEN || '').trim();
const DISCORD_GUILD_ID = String(process.env.DISCORD_GUILD_ID || '').trim();
const DISCORD_BOT_API_URL = String(process.env.DISCORD_BOT_API_URL || '').trim().replace(/\/+$/, '');
const INTERNAL_API_SECRET = String(process.env.INTERNAL_API_SECRET || '').trim();
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'schedule_state';
const SUPABASE_RECORD_ID = process.env.SUPABASE_RECORD_ID || 'main';
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

let memorySchedule = { courses: [], sessions: [], updatedAt: null };

// Optional: prefer using @supabase/supabase-js on the server if installed
let supabaseClient = null;
if(SUPABASE_ENABLED){
  try{
    const { createClient } = require('@supabase/supabase-js');
    const clientOptions = {};
    try {
      const ws = require('ws');
      clientOptions.realtime = { transport: ws };
    } catch (_) { /* ws not installed; Node >=22 has global WebSocket */ }
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOptions);
    console.log('Supabase client initialized (server SDK)');
  }catch(e){
    // SDK not installed, we'll use REST fallback already implemented
    supabaseClient = null;
  }
}

if(!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET){
  console.warn('DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set. Fill .env or env vars.');
}
if(!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID){
  console.warn('DISCORD_BOT_TOKEN or DISCORD_GUILD_ID not set. Guild auto-join will be skipped.');
}
if(!DISCORD_BOT_API_URL || !INTERNAL_API_SECRET){
  console.warn('DISCORD_BOT_API_URL or INTERNAL_API_SECRET not set. Bot-service join fallback will be skipped.');
}
if(!SUPABASE_ENABLED){
  console.warn('Supabase env not set. Schedule API will use in-memory fallback only.');
}

app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'changeme'],
  maxAge: 24 * 60 * 60 * 1000
}));

app.use(express.json({ limit: '1mb' }));

app.use(express.static('.'));

function normalizeSchedule(payload){
  const data = payload && typeof payload === 'object' ? payload : {};
  return {
    courses: Array.isArray(data.courses) ? data.courses : [],
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    updatedAt: data.updatedAt || Date.now()
  };
}

async function supabaseFetch(path, options = {}){
  if(!SUPABASE_ENABLED) throw new Error('Supabase is not configured');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  return response;
}

function mapCoursesAndSessions(courses, sessions){
  const mappedCourses = (courses || []).map(c => ({
    id: c.id,
    name: c.name,
    topic: c.topic,
    level: c.level,
    total: c.total,
    used: c.used,
    locked: c.locked,
    sessions: (sessions || [])
      .filter(s => s.course_id === c.id)
      .map(s => ({ day: s.day, time: s.time, label: s.label, forceFull: s.force_full }))
  }));
  const mappedSessions = (sessions || []).map(s => {
    const course = (courses || []).find(c => c.id === s.course_id) || {};
    return {
      courseId: s.course_id,
      courseName: course.name || s.course_id,
      day: s.day, time: s.time, label: s.label, forceFull: s.force_full,
      topic: course.topic, level: course.level, used: course.used, total: course.total
    };
  });
  return { courses: mappedCourses, sessions: mappedSessions, updatedAt: Date.now() };
}

async function readSchedule(){
  if(!SUPABASE_ENABLED){
    throw new Error('Supabase not configured on server');
  }
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    Accept: 'application/json'
  };
  const baseUrl = `${SUPABASE_URL}/rest/v1`;
  const response = await axios.get(`${baseUrl}/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(SUPABASE_RECORD_ID)}&select=payload,updated_at`, { headers });
  if(response.status < 200 || response.status >= 300){
    throw new Error(`schedule_state: HTTP ${response.status}`);
  }
  const payload = response.data?.[0]?.payload || { courses: [], sessions: [] };
  return normalizeSchedule(payload);
}

async function writeSchedule(payload){
  if(!SUPABASE_ENABLED){
    throw new Error('Supabase not configured on server');
  }
  const normalized = normalizeSchedule(payload);

  const response = await axios.post(
    `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?on_conflict=id`,
    {
      id: SUPABASE_RECORD_ID,
      payload: normalized,
      updated_at: new Date().toISOString()
    },
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      validateStatus: () => true
    }
  );
  if(response.status < 200 || response.status >= 300){
    throw new Error(`schedule_state: HTTP ${response.status} ${JSON.stringify(response.data || {})}`);
  }
  return normalized;
}

async function addUserToGuildDirect(accessToken, userId){
  if(!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID){
    return false;
  }

  const response = await axios.put(
    `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${userId}`,
    { access_token: accessToken },
    {
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    }
  );

  return response.status === 201 || response.status === 204;
}

async function addUserToGuildViaBotApi(accessToken, userId){
  if(!DISCORD_BOT_API_URL || !INTERNAL_API_SECRET){
    return false;
  }

  const response = await axios.post(`${DISCORD_BOT_API_URL}/internal/add-member`, {
    userId,
    accessToken,
    secret: INTERNAL_API_SECRET
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 5000
  });

  return response.status >= 200 && response.status < 300 && response.data?.ok === true;
}

app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email guilds.join'
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const code = req.query.code;
  if(!code) return res.status(400).send('No code');
  try{
    const params = new URLSearchParams();
    params.append('client_id', DISCORD_CLIENT_ID);
    params.append('client_secret', DISCORD_CLIENT_SECRET);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', DISCORD_REDIRECT_URI);
    params.append('scope', 'identify email guilds.join');

    const tokenRes = await axios.post('https://discord.com/api/oauth2/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const token = tokenRes.data;
    const userRes = await axios.get('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    const user = userRes.data;

    let addedToGuild = false;
    try{
      if(!DISCORD_BOT_API_URL || !INTERNAL_API_SECRET){
        console.error('Bot API URL or INTERNAL_API_SECRET missing - cannot add user to guild via bot service');
        addedToGuild = false;
      } else {
        addedToGuild = await addUserToGuildViaBotApi(token.access_token, user.id);
        if(!addedToGuild){
          console.error('Bot API add-member failed or returned not ok');
        }
      }
    }catch(err){
      console.error('Guild join error', err?.response?.data || err.message);
      addedToGuild = false;
    }

    req.session.user = user;
    req.session.token = token;
    req.session.guildJoinStatus = addedToGuild ? 'joined' : 'skipped';

    res.redirect('/');
  }catch(err){
    console.error('OAuth callback error', err?.response?.data || err.message);
    res.status(500).send('OAuth error');
  }
});

app.get('/me', (req, res) => {
  if(req.session && req.session.user){
    return res.json({ loggedIn: true, user: req.session.user });
  }
  res.status(401).json({ loggedIn: false });
});

app.get('/api/schedule', async (req, res) => {
  try{
    const schedule = await readSchedule();
    res.json(schedule);
  }catch(err){
    console.error('Schedule read error', err);
    res.status(500).json({
      error: err?.message || 'Failed to load schedule',
      detail: err?.response?.data || null
    });
  }
});
app.put('/api/schedule', async (req, res) => {
  try{
    const saved = await writeSchedule(req.body);
    res.json(saved);
  }catch(err){
    console.error('Schedule write error', err);
    res.status(500).json({
      error: err?.message || 'Failed to save schedule',
      detail: err?.response?.data || null
    });
  }
});

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

const bookingsHandler = require('./api/bookings');
app.all('/api/bookings', (req, res) => {
  req.query = req.query || {};
  return bookingsHandler(req, res);
});

const verificationHandler = require('./api/verification');
app.all('/verification', (req, res) => {
  req.query = req.query || {};
  return verificationHandler(req, res);
});

app.listen(WEB_PORT, '0.0.0.0', () => console.log(`Server running on http://0.0.0.0:${WEB_PORT}`));