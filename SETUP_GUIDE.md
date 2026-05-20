# 🚀 Setup Guide: Discord Bot Auto-Join & Messaging

## Problem
✅ Web login works fine  
❌ Bot doesn't auto-join server  
❌ Bot doesn't send welcome message

## Solution
You need to properly configure environment variables on both **Railway** (bot service) and **Vercel** (web service) so they can communicate.

---

## 🔧 Step 1: Railway Bot Service Setup

On Railway, you need to set these environment variables:

### Required Variables:
```
DISCORD_BOT_TOKEN = <your_bot_token>
DISCORD_GUILD_ID = <your_server_id>
DISCORD_CLIENT_ID = <oauth_client_id>
DISCORD_CLIENT_SECRET = <oauth_client_secret>
DISCORD_REDIRECT_URI = https://kyo-course.vercel.app/auth/discord/callback
INTERNAL_API_SECRET = <random_secret_string>
SESSION_SECRET = <random_secret_string>
PORT = 3000
```

### How to get these values:

1. **DISCORD_BOT_TOKEN**: 
   - Go to https://discord.com/developers/applications
   - Select your app → Bot → Copy Token

2. **DISCORD_GUILD_ID**:
   - Go to your Discord server
   - Right-click server → Copy Server ID

3. **DISCORD_CLIENT_ID & DISCORD_CLIENT_SECRET**:
   - Discord Developer Portal → Your App → General Information

4. **INTERNAL_API_SECRET**:
   - Generate a random string (e.g., using: `openssl rand -hex 32`)

5. **SESSION_SECRET**:
   - Generate a random string (same as above)

---

## 🔧 Step 2: Vercel Web Service Setup

On Vercel, you need to set these environment variables:

### Required Variables:
```
DISCORD_CLIENT_ID = <same_as_railway>
DISCORD_CLIENT_SECRET = <same_as_railway>
DISCORD_REDIRECT_URI = https://kyo-course.vercel.app/auth/discord/callback
DISCORD_BOT_API_URL = https://<your-railway-bot-url>
INTERNAL_API_SECRET = <same_as_railway>
SUPABASE_URL = <your_supabase_url>
SUPABASE_SERVICE_ROLE_KEY = <your_supabase_key>
```

### Important:
- **DISCORD_BOT_API_URL**: This is the public URL of your Railway bot service
  - Go to Railway dashboard → Select bot service → View Deployment
  - Copy the public URL (e.g., `https://your-bot-service.railway.app`)
  - Make sure it's accessible from the internet

---

## 🔗 How It Works (Flow)

```
1. User clicks "Login with Discord" on web
   ↓
2. Discord redirects to Vercel: /auth/discord/callback
   ↓
3. Vercel exchanges code for user token
   ↓
4. Vercel calls Railway bot: /internal/add-member
   (with INTERNAL_API_SECRET verification)
   ↓
5. Railway bot adds user to Discord server
   ↓
6. Railway bot sends welcome DM to user
   ↓
7. User is logged in & in the server ✅
```

---

## ✅ Testing Checklist

After setting up environment variables:

1. **Check Railway Bot Service Status**:
   - View logs in Railway dashboard
   - Should see: `✅ Bot đã online: YourBot#0000`

2. **Test Login Flow**:
   - Go to https://kyo-course.vercel.app
   - Click "Login with Discord"
   - Check Vercel logs → should see `✅ User added to guild via bot API`

3. **Check Discord**:
   - Go to your Discord server
   - User should appear as a new member
   - User should receive a welcome DM

4. **Verify Environment Variables**:
   - Railway: All variables set ✅
   - Vercel: All variables set ✅
   - INTERNAL_API_SECRET matches on both ✅

---

## 🐛 Troubleshooting

### Bot doesn't add user to server
- Check logs for: `❌ Bot API add-member failed`
- Verify: `DISCORD_BOT_API_URL` is correct and accessible
- Verify: `INTERNAL_API_SECRET` matches on both sides
- Check: Bot has "MANAGE_GUILD_MEMBERS" permission in Discord

### Bot doesn't send DM
- Check logs for: `❌ internal send-dm failed`
- Verify: Bot can send DMs (check Discord permissions)
- User might have DMs disabled from non-friends

### 403 Forbidden on API calls
- INTERNAL_API_SECRET doesn't match between services
- Check both Railway and Vercel configs

### Connection timeout
- DISCORD_BOT_API_URL is not accessible
- Railway deployment is not running
- Check Railway logs for crashes

---

## 📝 Files Modified
- `discord-bot/server.js` - Added `/internal/send-dm` endpoint
- `api/auth/discord/callback.js` - Updated to call bot service for DM

## 🎯 Next Steps
1. Get your Discord bot token and server ID
2. Set all environment variables on Railway
3. Copy Railway URL and set `DISCORD_BOT_API_URL` on Vercel
4. Test the login flow
5. Check Discord for new members and DMs
