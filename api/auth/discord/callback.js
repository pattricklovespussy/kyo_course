const axios = require('axios');
const { addMemberToGuild, isDiscordConfigured, sendChannelMessage } = require('../../_discord');

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

    const userId = userRes.data?.id;
    const username = userRes.data?.username;
    let addedToGuild = false;
    let sentDM = false;

    // Auto-join user into guild:
    // Prefer asking the running bot process to add the member if configured (more reliable).
    const botApiUrl = process.env.DISCORD_BOT_API_URL; // e.g. https://your-bot.example.com
    const internalSecret = process.env.INTERNAL_API_SECRET;
    
    if (botApiUrl && internalSecret) {
      console.log('Using bot API for add-member and send-dm');
      try {
        // Add to guild
        const addResp = await axios.post(`${botApiUrl.replace(/\/$/, '')}/internal/add-member`, {
          userId,
          accessToken,
          secret: internalSecret
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 5000 });
        
        addedToGuild = addResp.data?.ok === true;
        if (addedToGuild) {
          console.log('✅ User added to guild via bot API');
        } else {
          console.warn('⚠️ Bot API add-member response:', addResp.data);
        }
      } catch (err) {
        console.warn('❌ Bot API add-member failed:', err?.response?.data || err.message);
      }

      // Send welcome DM
      if (userId) {
        sentDM = await sendWelcomeDM(userId, username, botApiUrl, internalSecret);
        if (sentDM) {
          console.log('✅ Welcome DM sent via bot API');
        } else {
          console.warn('⚠️ Could not send DM via bot API');
        }
      }
    } else if (isDiscordConfigured()) {
      console.log('Using direct Discord API for add-member');
      const joinResult = await addMemberToGuild({
        userId,
        accessToken
      });
      
      addedToGuild = joinResult.ok;
      if (addedToGuild) {
        console.log('✅ User added to guild via direct API');
      } else {
        console.warn('❌ Discord guild join failed:', joinResult.reason);
        if (joinResult.raw) console.warn('Join raw response:', joinResult.raw);
      }
      
      // Try to send message to notify channel instead
      if (addedToGuild) {
        const notifyResult = await sendChannelMessage(`✅ **${username}** just joined the server!`);
        console.log('Channel message:', notifyResult);
      }
    } else {
      console.warn('⚠️ Neither bot API nor direct Discord API is configured');
    }

    setSessionCookie(res, { user: userRes.data });
    res.status(302).setHeader('Location', '/');
    return res.end();
  } catch (error) {
    console.error('Discord OAuth callback failed', error?.response?.data || error.message);
    res.status(500).send('OAuth callback failed');
  }
};
