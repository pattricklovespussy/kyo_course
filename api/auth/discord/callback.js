const axios = require('axios');
const querystring = require('querystring');
const { addMemberToGuild, isDiscordConfigured } = require('../../_discord');

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
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      querystring.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    console.log('Discord token response:', tokenRes.data);
    const accessToken = tokenRes.data.access_token;
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    console.log('Discord user info:', userRes.data);

    // Auto-join user into guild if bot and guild env vars are configured.
    if (isDiscordConfigured()) {
      const joinResult = await addMemberToGuild({
        userId: userRes.data?.id,
        accessToken
      });
      if (!joinResult.ok) {
        console.warn('Discord guild join failed:', joinResult.reason);
        // Expose more details for debugging when available
        if (joinResult.raw) console.warn('Join raw response:', joinResult.raw);
      } else {
        console.log('User added to guild successfully');
      }
    }

    setSessionCookie(res, { user: userRes.data });
    res.redirect('/');
  } catch (error) {
    console.error('Discord OAuth callback failed', error?.response?.data || error.message);
    res.status(500).send('OAuth callback failed');
  }
};
