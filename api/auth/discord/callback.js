const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_DISCORD_USERS_TABLE = process.env.SUPABASE_DISCORD_USERS_TABLE || 'discord_users';
const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

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
  if (!botApiUrl || !internalSecret) {
    return false;
  }
  try {
    const resp = await axios.post(`${botApiUrl.replace(/\/$/, '')}/internal/send-dm`, {
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
  if (!supabase) {
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

  const { error } = await supabase
    .from(SUPABASE_DISCORD_USERS_TABLE)
    .upsert(row, { onConflict: 'user_id' });

  if (error) {
    return { ok: false, reason: error.message || String(error), raw: error };
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
  const redirectUri = process.env.DISCORD_REDIRECT_URI || 'https://kyo-course.vercel.app/auth/discord/callback';

  if (!clientId || !clientSecret) {
    return res.status(500).send('Missing Discord OAuth env vars');
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
    const botApiUrl = process.env.DISCORD_BOT_API_URL;
    const internalSecret = process.env.INTERNAL_API_SECRET;

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
        console.warn('❌ Bot API add-member failed:', err?.response?.data || err.message);
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
