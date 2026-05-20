const axios = require('axios');

function isDiscordConfigured() {
  return Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID);
}

async function addMemberToGuild({ userId, accessToken }) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!botToken || !guildId || !userId || !accessToken) {
    return { ok: false, reason: 'missing-config-or-input' };
  }

  try {
    await axios.put(
      `https://discord.com/api/guilds/${guildId}/members/${userId}`,
      {
        access_token: accessToken,
      },
      {
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        }
      }
    );
    return { ok: true };
  } catch (error) {
    const raw = error?.response?.data || null;
    return {
      ok: false,
      reason: raw?.message || error.message || 'discord-join-failed',
      raw
    };
  }
}

async function sendChannelMessage(content) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_NOTIFY_CHANNEL_ID;
  if (!botToken || !channelId || !content) {
    return { ok: false, reason: 'missing-config-or-content' };
  }

  try {
    await axios.post(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      { content },
      {
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error?.response?.data?.message || error.message || 'discord-message-failed'
    };
  }
}

module.exports = {
  isDiscordConfigured,
  addMemberToGuild,
  sendChannelMessage
};