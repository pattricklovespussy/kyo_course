function getPublicBaseUrl(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return '';
  return `${proto}://${host}`;
}

module.exports = (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const baseUrl = String(process.env.APP_BASE_URL || process.env.PUBLIC_URL || getPublicBaseUrl(req) || '').trim().replace(/\/+$/, '');
  const redirectUri = process.env.DISCORD_REDIRECT_URI || (baseUrl ? `${baseUrl}/auth/discord/callback` : '');

  if (!clientId) {
    return res.status(500).send('Missing DISCORD_CLIENT_ID');
  }
  if (!redirectUri) {
    return res.status(500).send('Missing redirect base URL');
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
