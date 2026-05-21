const express = require('express');
const axios = require('axios');
const cookieSession = require('cookie-session');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/auth/discord/callback`;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'schedule_state';
const SUPABASE_RECORD_ID = process.env.SUPABASE_RECORD_ID || 'main';
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

let memorySchedule = { courses: [], sessions: [], updatedAt: null };

// Optional: prefer using @supabase/supabase-js on the server if installed
let supabaseClient = null;
if(SUPABASE_ENABLED){
  try{
    const { createClient } = require('@supabase/supabase-js');
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log('Supabase client initialized (server SDK)');
  }catch(e){
    // SDK not installed, we'll use REST fallback already implemented
    supabaseClient = null;
  }
}

if(!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET){
  console.warn('DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set. Fill .env or env vars.');
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

async function readSchedule(){
  if(SUPABASE_ENABLED){
    if(supabaseClient){
      const { data, error } = await supabaseClient
        .from(SUPABASE_TABLE)
        .select('payload,updated_at')
        .eq('id', SUPABASE_RECORD_ID)
        .limit(1)
        .single();
      if(error) throw error;
      return normalizeSchedule(data?.payload || {});
    }
    const response = await supabaseFetch(
      `${SUPABASE_TABLE}?id=eq.${encodeURIComponent(SUPABASE_RECORD_ID)}&select=payload,updated_at`,
      { method: 'GET', headers: { Accept: 'application/json' } }
    );
    if(!response.ok){
      if (response.status === 404) {
        return normalizeSchedule(memorySchedule);
      }
      const text = await response.text().catch(() => '');
      throw new Error(`Failed to read schedule: ${response.status} ${text}`);
    }
    const rows = await response.json();
    const payload = rows?.[0]?.payload || { courses: [], sessions: [] };
    return normalizeSchedule(payload);
  }
  return normalizeSchedule(memorySchedule);
}

async function writeSchedule(payload){
  const normalized = normalizeSchedule(payload);
  if(SUPABASE_ENABLED){
    if(supabaseClient){
      const { data, error } = await supabaseClient
        .from(SUPABASE_TABLE)
        .upsert({ id: SUPABASE_RECORD_ID, payload: normalized, updated_at: new Date().toISOString() }, { returning: 'minimal' });
      if(error) throw error;
      return normalized;
    }
    const response = await supabaseFetch(`${SUPABASE_TABLE}?on_conflict=id`, {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify({
        id: SUPABASE_RECORD_ID,
        payload: normalized,
        updated_at: new Date().toISOString()
      })
    });
    if(!response.ok){
      const text = await response.text();
      throw new Error(`Failed to save schedule: ${response.status} ${text}`);
    }
    return normalized;
  }
  memorySchedule = normalized;
  return normalized;
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

    req.session.user = user;
    req.session.token = token;

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
    console.error('Schedule read error', err.message);
    res.status(500).json({ error: 'Failed to load schedule' });
  }
});

app.put('/api/schedule', async (req, res) => {
  try{
    const saved = await writeSchedule(req.body);
    res.json(saved);
  }catch(err){
    console.error('Schedule write error', err.message);
    res.status(500).json({ error: 'Failed to save schedule' });
  }
});

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
