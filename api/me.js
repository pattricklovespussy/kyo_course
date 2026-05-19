function readCookie(headerValue, name) {
  if (!headerValue) return null;
  const pairs = headerValue.split(';').map(part => part.trim());
  const found = pairs.find(part => part.startsWith(`${name}=`));
  return found ? found.slice(name.length + 1) : null;
}

module.exports = (req, res) => {
  const cookieHeader = req.headers.cookie || '';
  const raw = readCookie(cookieHeader, 'kyo_session');
  if (!raw) {
    return res.status(401).json({ loggedIn: false });
  }

  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!decoded || !decoded.user) {
      return res.status(401).json({ loggedIn: false });
    }

    return res.json({ loggedIn: true, user: decoded.user });
  } catch (error) {
    return res.status(401).json({ loggedIn: false });
  }
};
