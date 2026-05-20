const express = require('express');
const session = require('express-session');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── CONFIG (đọc từ .env) ──────────────────────────────────────────────
const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID,       // ID server Discord của bạn
  DISCORD_REDIRECT_URI,   // VD: http://localhost:3000/callback
  SESSION_SECRET,
} = process.env;

// ── SESSION ───────────────────────────────────────────────────────────
app.use(session({
  secret: SESSION_SECRET || 'kyo-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ── DISCORD BOT ───────────────────────────────────────────────────────
const bot = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// `ready` event was renamed to `clientReady` in discord.js v15.
// Listen to both names but ensure the handler runs only once.
let _readyHandled = false;
function _handleReady() {
  if (_readyHandled) return;
  _readyHandled = true;
  console.log(`✅ Bot đã online: ${bot.user.tag}`);
}
bot.once('clientReady', _handleReady);
bot.once('ready', _handleReady);

bot.login(DISCORD_BOT_TOKEN);

// Helper: gửi DM cho user
async function sendDM(userId, embed) {
  try {
    const user = await bot.users.fetch(userId);
    await user.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error('Không thể gửi DM:', err.message);
    return false;
  }
}

// Helper: thêm user vào server
async function addUserToGuild(accessToken, userId) {
  try {
    const guild = await bot.guilds.fetch(DISCORD_GUILD_ID);
    await guild.members.add(userId, { accessToken });
    return true;
  } catch (err) {
    console.error('Lỗi add member:', err.message);
    return false;
  }
}

// ── OAUTH2: Redirect đến Discord ─────────────────────────────────────
app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds.join',
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// ── OAUTH2: Callback từ Discord ───────────────────────────────────────
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  try {
    // 1. Đổi code lấy access token
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: DISCORD_REDIRECT_URI,
        scope: 'identify guilds.join',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token } = tokenRes.data;

    // 2. Lấy thông tin user
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const user = userRes.data;

    // 3. Lưu session
    req.session.user = { ...user, access_token };
    req.session.loggedIn = true;

    // 4. Tự động thêm vào server
    await addUserToGuild(access_token, user.id);

    // 5. Gửi DM đăng nhập thành công
    const loginEmbed = new EmbedBuilder()
      .setColor(0xE8B84B)
      .setTitle('✅ Đăng nhập thành công!')
      .setDescription(`Xin chào **${user.username}**! Bạn đã đăng nhập vào **TradingWithKyo Schedule Hub** thành công.`)
      .addFields(
        { name: '🏫 Server', value: 'Bạn đã được thêm vào server TradingWithKyo', inline: false },
        { name: '📅 Tiếp theo', value: 'Hãy chọn một slot học và đặt lịch của bạn!', inline: false }
      )
      .setFooter({ text: 'TradingWithKyo — Schedule Hub' })
      .setTimestamp();

    await sendDM(user.id, loginEmbed);

    res.redirect('/?login=success');
  } catch (err) {
    console.error('OAuth error:', err.response?.data || err.message);
    res.redirect('/?error=auth_failed');
  }
});

// ── API: Lấy thông tin user hiện tại ─────────────────────────────────
app.get('/me', (req, res) => {
  if (req.session.loggedIn && req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// ── API: Đăng xuất ────────────────────────────────────────────────────
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ── API: Đặt slot ─────────────────────────────────────────────────────
app.post('/api/bookings', async (req, res) => {
  if (!req.session.loggedIn) {
    return res.status(401).json({ error: 'Chưa đăng nhập' });
  }

  const { courseId, day, time, slotKey } = req.body;
  const user = req.session.user;

  // Lưu booking vào session (thay bằng DB thật nếu cần)
  if (!req.session.bookings) req.session.bookings = [];
  const booking = {
    id: Date.now().toString(),
    userId: user.id,
    courseId, day, time, slotKey,
    createdAt: new Date().toISOString()
  };
  req.session.bookings.push(booking);

  // Gửi DM thông báo book slot thành công
  const bookEmbed = new EmbedBuilder()
    .setColor(0x4DB87A)
    .setTitle('📅 Đặt slot thành công!')
    .setDescription(`Bạn đã giữ slot học thành công trên **TradingWithKyo Schedule Hub**.`)
    .addFields(
      { name: '📚 Khóa học', value: courseId || 'N/A', inline: true },
      { name: '⏰ Thời gian', value: time || 'N/A', inline: true },
      { name: '📆 Ngày', value: `Ngày ${day + 1} trong tuần`, inline: true },
      { name: '🔖 Mã booking', value: `\`${booking.id}\``, inline: false }
    )
    .setFooter({ text: 'TradingWithKyo — Hẹn gặp bạn trong buổi học!' })
    .setTimestamp();

  await sendDM(user.id, bookEmbed);

  res.json({ success: true, booking });
});

// ── API: Huỷ slot ─────────────────────────────────────────────────────
app.delete('/api/bookings/:bookingId', async (req, res) => {
  if (!req.session.loggedIn) {
    return res.status(401).json({ error: 'Chưa đăng nhập' });
  }

  const { bookingId } = req.params;
  const user = req.session.user;

  // Xoá booking khỏi session
  if (req.session.bookings) {
    req.session.bookings = req.session.bookings.filter(b => b.id !== bookingId);
  }

  // Gửi DM thông báo huỷ thành công
  const cancelEmbed = new EmbedBuilder()
    .setColor(0xE06060)
    .setTitle('❌ Huỷ slot thành công')
    .setDescription(`Bạn đã huỷ slot học thành công trên **TradingWithKyo Schedule Hub**.`)
    .addFields(
      { name: '🔖 Mã booking đã huỷ', value: `\`${bookingId}\``, inline: false },
      { name: '💡 Lưu ý', value: 'Bạn có thể đặt lại slot khác bất cứ lúc nào.', inline: false }
    )
    .setFooter({ text: 'TradingWithKyo — Schedule Hub' })
    .setTimestamp();

  await sendDM(user.id, cancelEmbed);

  res.json({ success: true });
});

// ── API: Lấy danh sách booking của user ──────────────────────────────
app.get('/api/my-bookings', (req, res) => {
  if (!req.session.loggedIn) {
    return res.status(401).json({ error: 'Chưa đăng nhập' });
  }
  res.json({ bookings: req.session.bookings || [] });
});

// ── START SERVER ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
});
