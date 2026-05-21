const axios = require('axios');

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
  sendChannelMessage
};