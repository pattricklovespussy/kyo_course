# TradingWithKyo — Discord Bot Setup

## Tổng quan
Bot này làm 4 việc tự động:
- ✅ Khi user login Discord → tự **thêm vào server** của bạn
- 💬 Gửi DM: **"Đăng nhập thành công"**
- 📅 Gửi DM: **"Đặt slot thành công"**
- ❌ Gửi DM: **"Huỷ slot thành công"**

---

## ⚡ Deployment Flow

```
Vercel (Web)  →  call  →  Railway (Bot Service)  →  Discord API
   oauth                  /internal/add-member
   callback               /internal/send-dm
```

---

## Bước 1: Tạo Discord Application & Bot

1. Vào https://discord.com/developers/applications → **New Application**
2. Đặt tên (VD: `KyoScheduleBot`) → Create
3. Tab **OAuth2** → **Client ID** và **Client Secret** → copy lại
4. Tab **Bot** → **Add Bot** → copy **Token**
5. Bật các **Privileged Gateway Intents**:
   - ✅ Server Members Intent
   - ✅ Message Content Intent

---

## Bước 2: Cấu hình OAuth2 Redirect URI

Trong tab **OAuth2** → **Redirects** → Add:
```
https://kyo-course.vercel.app/auth/discord/callback
```
(Dùng URL thực của Vercel app của bạn)

---

## Bước 3: Lấy Bot vào Server (với quyền cần thiết)

Tạo invite link trong tab **OAuth2 → URL Generator**:
- Scopes: `bot`, `applications.commands`
- Bot Permissions: 
  - ✅ `Manage Roles`
  - ✅ `Send Messages` 
  - ✅ `Read Message History`

Mở link → mời bot vào server của bạn.

---

## Bước 4: Lấy Guild ID (ID Server)

1. Bật **Developer Mode** trong Discord Settings → Advanced
2. Chuột phải vào Server → **Copy Server ID**

---

## Bước 5: Setup Railway Deployment

### Environment Variables (Railway Bot Service)
```
DISCORD_BOT_TOKEN=<bot_token_from_step_1>
DISCORD_GUILD_ID=<server_id_from_step_4>
DISCORD_CLIENT_ID=<client_id_from_step_1>
DISCORD_CLIENT_SECRET=<client_secret_from_step_1>
DISCORD_REDIRECT_URI=https://kyo-course.vercel.app/auth/discord/callback
INTERNAL_API_SECRET=<random_secret_string>
SESSION_SECRET=<random_session_string>
PORT=3000
```

### Get Railway Public URL
1. Go to Railway dashboard → Bot service
2. Settings → Domains → Enable public URL
3. Copy the URL (e.g., `https://discord-bot-production.railway.app`)

---

## Bước 6: Setup Vercel Environment Variables

Add to Vercel project:
```
DISCORD_BOT_API_URL=https://discord-bot-production.railway.app
INTERNAL_API_SECRET=<same_as_railway>
DISCORD_CLIENT_ID=<client_id>
DISCORD_CLIENT_SECRET=<client_secret>
DISCORD_REDIRECT_URI=https://kyo-course.vercel.app/auth/discord/callback
```

---

## 🔑 Critical: INTERNAL_API_SECRET

Both Railway and Vercel **must have the exact same secret**:
- This is used for secure communication between services
- Generate with: `openssl rand -hex 32`
- Keep it secret! Do not commit to git

---

## ✅ Testing

1. Go to https://kyo-course.vercel.app
2. Click "Login with Discord"
3. Authorize
4. Check:
   - ✅ You're logged in
   - ✅ You appear in the Discord server
   - ✅ You receive a welcome DM

---

## 🐛 Debugging

Check logs:
- **Railway**: View service logs in dashboard
- **Vercel**: `vercel logs --prod`

Common issues:
- Bot doesn't appear: Check bot permissions in Discord
- User not added: Check DISCORD_BOT_API_URL is set
- 403 error: INTERNAL_API_SECRET doesn't match

---

## Bước 5: Cài đặt & Chạy

```bash
# Clone / copy thư mục này vào máy
cd discord-bot

# Cài thư viện
npm install

# Tạo file .env từ mẫu
cp .env.example .env

# Điền thông tin vào .env
nano .env

# Chạy server
npm start
```

---

## Bước 6: Tích hợp với index.html

Trong file `index.html`, tìm dòng:
```javascript
const DISCORD_AUTH_URL = '...';
```

Thay thành:
```javascript
const DISCORD_AUTH_URL = '/auth/discord';
```

Sau đó đặt `index.html` vào thư mục `public/` trong project này.

---

## Cấu trúc thư mục

```
discord-bot/
├── server.js          ← Server chính (Express + Bot)
├── package.json
├── .env               ← Thông tin bí mật (KHÔNG commit lên git)
├── .env.example       ← Mẫu cấu hình
├── README.md
└── public/
    └── index.html     ← Copy file index.html của bạn vào đây
```

---

## API Endpoints

| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/auth/discord` | Redirect đến Discord OAuth2 |
| GET | `/callback` | Discord redirect về sau khi login |
| GET | `/me` | Lấy thông tin user đang đăng nhập |
| GET | `/logout` | Đăng xuất |
| POST | `/api/bookings` | Đặt slot → gửi DM |
| DELETE | `/api/bookings/:id` | Huỷ slot → gửi DM |
| GET | `/api/my-bookings` | Danh sách booking của user |

---

## Deploy lên VPS / Hosting

```bash
# Cài PM2 để chạy nền
npm install -g pm2

# Khởi động
pm2 start server.js --name kyo-bot

# Tự khởi động khi reboot
pm2 startup && pm2 save
```

> ⚠️ **Lưu ý**: File `.env` chứa thông tin bí mật, **không được** đẩy lên GitHub.
> Thêm `.env` vào `.gitignore`.
