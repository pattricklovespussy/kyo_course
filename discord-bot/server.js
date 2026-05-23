const express = require('express');
const session = require('express-session');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');

// DEBUG: print env load status on startup
try {
  const envPath = path.join(__dirname, '.env');
  const exists = fs.existsSync(envPath);
  function masked(v) {
    if (!v) return '<empty>';
    if (v.length <= 8) return `${v.slice(0, 2)}...${v.slice(-2)}`;
    return `${v.slice(0, 4)}...${v.slice(-4)}`;
  }
  console.log(`[CONFIG] dotenv path: ${envPath} | exists: ${exists}`);
  console.log(`[CONFIG] DISCORD_BOT_TOKEN=${masked(process.env.DISCORD_BOT_TOKEN)}`);
  console.log(`[CONFIG] DISCORD_GUILD_ID=${masked(process.env.DISCORD_GUILD_ID)}`);
  console.log(`[CONFIG] INTERNAL_API_SECRET=${masked(process.env.INTERNAL_API_SECRET)}`);
} catch (e) {
  console.warn('[CONFIG] dotenv debug failed:', e?.message || e);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID,
  DISCORD_REDIRECT_URI,
  SESSION_SECRET,
} = process.env;

const BOT_TOKEN = String(DISCORD_BOT_TOKEN || '').trim();
const GUILD_ID = String(DISCORD_GUILD_ID || '').trim();
const INTERNAL_SECRET = String(process.env.INTERNAL_API_SECRET || '').trim();

if (!BOT_TOKEN) {
  console.error('[CONFIG] Missing DISCORD_BOT_TOKEN. Set it in env vars for the bot service.');
}
if (!GUILD_ID) {
  console.error('[CONFIG] Missing DISCORD_GUILD_ID. Set it in env vars for the bot service.');
}
if (!INTERNAL_SECRET) {
  console.warn('[CONFIG] Missing INTERNAL_API_SECRET. /internal/add-member will be forbidden.');
}

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

let _readyHandled = false;
function _handleReady() {
  if (_readyHandled) return;
  _readyHandled = true;
  console.log(`[BOT] Online: ${bot.user.tag}`);
}
bot.once('clientReady', _handleReady);
bot.once('ready', _handleReady);

if (BOT_TOKEN) {
  bot.login(BOT_TOKEN).catch((err) => {
    console.error('[BOT] Login failed:', err?.message || err);
    process.exitCode = 1;
  });
} else {
  console.error('[BOT] Login skipped — DISCORD_BOT_TOKEN missing.');
}

async function sendDM(userId, embed) {
  try {
    const user = await bot.users.fetch(userId);
    await user.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error('[DM] Failed to send DM to', userId, ':', err.message);
    return false;
  }
}

// FIX: Full detailed logging in addUserToGuild so we can see the exact Discord error
async function addUserToGuild(accessToken, userId) {
  console.log('[GUILD] addUserToGuild called');
  console.log('[GUILD] userId:', userId);
  console.log('[GUILD] accessToken prefix:', accessToken?.slice(0, 10), '...');
  console.log('[GUILD] BOT_TOKEN prefix:', BOT_TOKEN?.slice(0, 10), '...');
  console.log('[GUILD] GUILD_ID:', GUILD_ID);

  if (!BOT_TOKEN) {
    console.error('[GUILD] Cannot add member — BOT_TOKEN is empty');
    return false;
  }
  if (!GUILD_ID) {
    console.error('[GUILD] Cannot add member — GUILD_ID is empty');
    return false;
  }
  if (!accessToken) {
    console.error('[GUILD] Cannot add member — accessToken is empty');
    return false;
  }

  try {
    const url = `https://discord.com/api/v10/guilds/${GUILD_ID}/members/${userId}`;
    console.log('[GUILD] PUT', url);

    const response = await axios.put(url, {
      access_token: accessToken
    }, {
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      timeout: 8000,
      // FIX: Don't throw on 4xx so we can log the full Discord error body
      validateStatus: () => true
    });

    console.log('[GUILD] Discord response status:', response.status);
    console.log('[GUILD] Discord response data:', JSON.stringify(response.data));

    // 201 = added, 204 = already in guild (both are success)
    if (response.status === 201 || response.status === 204) {
      console.log('[GUILD] Success — user added or already in guild');
      return true;
    }

    console.error('[GUILD] Unexpected status from Discord:', response.status, response.data);
    return false;
  } catch (err) {
    console.error('[GUILD] Request threw unexpectedly:', {
      message: err?.message,
      status: err?.response?.status,
      data: err?.response?.data
    });
    return false;
  }
}

// FIX: OAuth scope is now 'identify guilds.join' with prompt=consent
// to force fresh token issuance with the correct scope
app.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds.join',
    prompt: 'consent'
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');

  console.log('[AUTH] OAuth callback received');

  try {
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

    const { access_token, scope: grantedScope } = tokenRes.data;
    console.log('[AUTH] Token received. Granted scopes:', grantedScope);

    // FIX: Warn if guilds.join scope is missing from the granted token
    if (!grantedScope || !grantedScope.includes('guilds.join')) {
      console.error('[AUTH] WARNING: guilds.join scope NOT in granted token! Granted:', grantedScope);
    }

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const user = userRes.data;
    console.log(`[AUTH] User: ${user.username}#${user.discriminator} (${user.id})`);

    req.session.user = { ...user, access_token };
    req.session.loggedIn = true;

    const guildResult = await addUserToGuild(access_token, user.id);
    console.log('[GUILD] addUserToGuild result:', guildResult);

    // Send DM regardless of guild join result
    const loginEmbed = new EmbedBuilder()
      .setColor(0xE8B84B)
      .setTitle('✅ Đăng nhập thành công!')
      .setDescription(`Xin chào **${user.username}**! Bạn đã đăng nhập vào **TradingWithKyo Schedule Hub** thành công.`)
      .addFields(
        { name: '🏫 Server', value: guildResult ? 'Bạn đã được thêm vào server TradingWithKyo' : 'Không thể tự động thêm vào server — vui lòng liên hệ admin', inline: false },
        { name: '📅 Tiếp theo', value: 'Hãy chọn một slot học và đặt lịch của bạn!', inline: false }
      )
      .setFooter({ text: 'TradingWithKyo — Schedule Hub' })
      .setTimestamp();

    await sendDM(user.id, loginEmbed);

    res.redirect('/?login=success');
  } catch (err) {
    console.error('[AUTH] OAuth error:', JSON.stringify({
      status: err?.response?.status,
      data: err?.response?.data,
      message: err?.message
    }, null, 2));
    res.redirect('/?error=auth_failed');
  }
});

// Internal endpoint: web server calls this to add a user to the guild
app.post('/internal/add-member', async (req, res) => {
  const secret = req.body?.secret || req.headers['x-internal-secret'];

  console.log('[INTERNAL] /add-member called');
  console.log('[INTERNAL] Secret match:', secret === INTERNAL_SECRET);

  if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
    console.error('[INTERNAL] Forbidden — secret mismatch');
    return res.status(403).json({ ok: false, message: 'forbidden' });
  }

  const userId = req.body?.userId;
  const accessToken = req.body?.accessToken;

  if (!userId || !accessToken) {
    return res.status(400).json({ ok: false, message: 'missing userId or accessToken' });
  }

  try {
    const ok = await addUserToGuild(accessToken, userId);
    if (!ok) {
      return res.status(500).json({ ok: false, message: 'failed to add member — check bot logs for Discord error details' });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[INTERNAL] add-member threw:', err?.response?.data || err.message);
    return res.status(500).json({ ok: false, message: err.message, raw: err?.response?.data || null });
  }
});

// Internal endpoint: send a welcome DM via bot
app.post('/internal/send-dm', async (req, res) => {
  const secret = req.body?.secret || req.headers['x-internal-secret'];
  if (!INTERNAL_SECRET || secret !== INTERNAL_SECRET) {
    return res.status(403).json({ ok: false, message: 'forbidden' });
  }

  const userId = req.body?.userId;
  const username = req.body?.username;
  if (!userId) return res.status(400).json({ ok: false, message: 'missing userId' });

  try {
    const loginEmbed = new EmbedBuilder()
      .setColor(0xE8B84B)
      .setTitle('✅ Đăng nhập thành công!')
      .setDescription(`Xin chào **${username || 'bạn'}**! Bạn đã đăng nhập vào **TradingWithKyo Schedule Hub** thành công.`)
      .addFields(
        { name: '🏫 Server', value: 'Bạn đã được thêm vào server TradingWithKyo', inline: false },
        { name: '📅 Tiếp theo', value: 'Hãy chọn một slot học và đặt lịch của bạn!', inline: false }
      )
      .setFooter({ text: 'TradingWithKyo — Schedule Hub' })
      .setTimestamp();

    const success = await sendDM(userId, loginEmbed);
    if (success) return res.json({ ok: true });
    return res.status(500).json({ ok: false, message: 'Failed to send DM' });
  } catch (err) {
    console.error('[INTERNAL] send-dm failed:', err.message);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

app.get('/me', (req, res) => {
  if (req.session.loggedIn && req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.post('/api/bookings', async (req, res) => {
  if (!req.session.loggedIn) {
    return res.status(401).json({ error: 'Chưa đăng nhập' });
  }

  const { courseId, day, time, slotKey } = req.body;
  const user = req.session.user;

  if (!req.session.bookings) req.session.bookings = [];
  const booking = {
    id: Date.now().toString(),
    userId: user.id,
    courseId, day, time, slotKey,
    createdAt: new Date().toISOString()
  };
  req.session.bookings.push(booking);

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

app.delete('/api/bookings/:bookingId', async (req, res) => {
  if (!req.session.loggedIn) {
    return res.status(401).json({ error: 'Chưa đăng nhập' });
  }

  const { bookingId } = req.params;
  const user = req.session.user;

  if (req.session.bookings) {
    req.session.bookings = req.session.bookings.filter(b => b.id !== bookingId);
  }

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

app.get('/api/my-bookings', (req, res) => {
  if (!req.session.loggedIn) {
    return res.status(401).json({ error: 'Chưa đăng nhập' });
  }
  res.json({ bookings: req.session.bookings || [] });
});

const BOT_PORT = process.env.BOT_PORT || process.env.PORT || 3000;
app.listen(BOT_PORT, () => {
  console.log(`[SERVER] Bot server running on http://localhost:${BOT_PORT}`);
});
