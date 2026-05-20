module.exports = (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI || 'https://kyo-course.vercel.app/auth/discord/callback';

  if (!clientId) {
    return res.status(500).send('Missing DISCORD_CLIENT_ID');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'identify email guilds.join'
  });

  res.status(302).setHeader('Location', `https://discord.com/oauth2/authorize?${params.toString()}`);
  return res.end();
};
