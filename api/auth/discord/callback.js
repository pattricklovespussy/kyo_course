const axios = require('axios');
const { normalizeHttpUrl } = require('../../_utils');

const SUPABASE_URL = normalizeHttpUrl(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_DISCORD_USERS_TABLE = process.env.SUPABASE_DISCORD_USERS_TABLE || 'discord_users';

const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

function getPublicBaseUrl(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return '';
  return `${proto}://${host}`;
}

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

function setSessionCookie(res, payload) {
  const value = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const cookieParts = [
    `kyo_session=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${60 * 60 * 24}`
  ];

  if (process.env.NODE_ENV === 'production') {
    cookieParts.push('Secure');
  }

  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

// Helper: gửi DM cho user qua bot
async function sendWelcomeDM(userId, username, botApiUrl, internalSecret) {
  const normalizedBotApiUrl = normalizeHttpUrl(botApiUrl);

  if (!normalizedBotApiUrl || !internalSecret) {
    return false;
  }
  try {
    const resp = await axios.post(`${normalizedBotApiUrl}/internal/send-dm`, {
      userId,
      username,
      secret: internalSecret
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 5000 });
    return resp.data?.ok === true;
  } catch (err) {
    console.warn('Send DM failed:', err?.response?.data || err.message);
    return false;
  }
}

async function saveDiscordAuth(user, tokenRes) {
  if (!SUPABASE_ENABLED) {
    return { ok: false, reason: 'supabase-not-configured' };
  }

  const row = {
    user_id: String(user?.id || '').trim(),
    discord_id: String(user?.id || '').trim(),
    discord_username: String(user?.username || '').trim(),
    discord_access_token: String(tokenRes?.access_token || '').trim(),
    discord_refresh_token: String(tokenRes?.refresh_token || '').trim() || null,
    discord_token_scope: String(tokenRes?.scope || '').trim() || null,
    discord_token_type: String(tokenRes?.token_type || '').trim() || null,
    discord_avatar: String(user?.avatar || '').trim() || null,
    updated_at: new Date().toISOString()
  };

  if (!row.user_id || !row.discord_id || !row.discord_access_token) {
    return { ok: false, reason: 'missing-auth-fields' };
  }

  const response = await supabaseRest('POST', SUPABASE_DISCORD_USERS_TABLE, {
    query: 'on_conflict=user_id',
    data: row
  });

  if (response.status < 200 || response.status >= 300) {
    return { ok: false, reason: `HTTP ${response.status}`, raw: response.data || null };
  }

  return { ok: true };
}

module.exports = async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Missing code');
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const baseUrl = String(process.env.APP_BASE_URL || process.env.PUBLIC_URL || getPublicBaseUrl(req) || '').trim().replace(/\/+$/, '');
  const redirectUri = process.env.DISCORD_REDIRECT_URI || (baseUrl ? `${baseUrl}/auth/discord/callback` : '');

  if (!clientId || !clientSecret) {
    return res.status(500).send('Missing Discord OAuth env vars');
  }
  if (!redirectUri) {
    return res.status(500).send('Missing redirect base URL');
  }

  try {
    console.log('Discord callback env flags:', {
      hasBotApiUrl: Boolean(process.env.DISCORD_BOT_API_URL),
      hasInternalSecret: Boolean(process.env.INTERNAL_API_SECRET),
      hasBotToken: Boolean(process.env.DISCORD_BOT_TOKEN),
      hasGuildId: Boolean(process.env.DISCORD_GUILD_ID)
    });

    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    console.log('Discord token response:', tokenRes.data);
    const accessToken = tokenRes.data.access_token;
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    console.log('Discord user info:', userRes.data);

    const savedAuth = await saveDiscordAuth(userRes.data, tokenRes.data);
    if (savedAuth.ok) {
      console.log('✅ Discord auth saved to Supabase');
    } else {
      console.warn('⚠️ Could not save Discord auth to Supabase:', savedAuth.reason);
    }

    const userId = userRes.data?.id;
    const username = userRes.data?.username;
    const botApiUrl = normalizeHttpUrl(process.env.DISCORD_BOT_API_URL);
    const internalSecret = process.env.INTERNAL_API_SECRET;

    console.log('Discord callback add-member config:', {
      botApiUrl: botApiUrl || '<missing>',
      hasInternalSecret: Boolean(internalSecret),
      userId: userId || '<missing>'
    });

    let joinStatus = 'skipped';
    let addedToGuild = false;
    let sentDM = false;

    if (!botApiUrl || !internalSecret) {
      console.warn('⚠️ DISCORD_BOT_API_URL or INTERNAL_API_SECRET is missing, skipping add-member step');
    } else {
      console.log('Using bot API for add-member and send-dm only');

      try {
        const addResp = await axios.post(`${botApiUrl.replace(/\/$/, '')}/internal/add-member`, {
          userId,
          accessToken,
          secret: internalSecret
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 5000 });

        addedToGuild = addResp.data?.ok === true;
        joinStatus = addedToGuild ? 'joined' : 'failed';
        if (addedToGuild) {
          console.log('✅ User added to guild via bot API');
        } else {
          console.warn('⚠️ Bot API add-member response:', addResp.data);
        }
      } catch (err) {
        joinStatus = 'failed';
        console.warn('❌ Bot API add-member failed:', {
          status: err?.response?.status || null,
          data: err?.response?.data || null,
          message: err?.message || 'unknown-error'
        });
      }

      if (userId) {
        sentDM = await sendWelcomeDM(userId, username, botApiUrl, internalSecret);
        if (sentDM) {
          console.log('✅ Welcome DM sent via bot API');
        } else {
          console.warn('⚠️ Could not send DM via bot API');
        }
      }
    }

    setSessionCookie(res, { user: userRes.data, discordAuthSaved: savedAuth.ok, discordJoinStatus: joinStatus });
    res.status(302).setHeader('Location', `/?login=success&join=${joinStatus}`);
    return res.end();
  } catch (error) {
    console.error('Discord OAuth callback failed', error?.response?.data || error.message);
    res.status(500).send('OAuth callback failed');
  }
};
