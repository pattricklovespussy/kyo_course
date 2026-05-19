module.exports = (req, res) => {
  res.setHeader('Set-Cookie', [
    'kyo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    'kyo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure'
  ]);
  res.redirect('/');
};
