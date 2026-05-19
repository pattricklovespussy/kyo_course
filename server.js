const express = require('express');
const axios = require('axios');
const cookieSession = require('cookie-session');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/auth/discord/callback`;

if(!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET){
  console.warn('DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set. Fill .env or env vars.');
}

app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'changeme'],
  maxAge: 24 * 60 * 60 * 1000
}));

app.use(express.static('.'));

app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email'
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

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
