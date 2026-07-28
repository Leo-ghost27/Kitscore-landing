// Daily cron job: for every OAuth-connected Discord server, sample
// recent message history via the bot's REST access and compute a
// messages-per-member figure -- the closest available proxy for
// "is this community actually active" now that a real bot (message-read
// access) exists, as opposed to the plain OAuth login used for
// follower_count/subscriber_count.
//
// Deliberately NOT using Discord's Gateway (the always-on WebSocket
// connection real-time bots use) -- Vercel's serverless model can't
// keep a persistent connection open. This samples a window of recent
// history instead, once a day. Less precise than true real-time
// tracking, but needs no separate always-on hosting.
const { adminClient } = require('../supabase-admin');

const DISCORD_API_BASE = 'https://discord.com/api/v10';
// Discord gives no way to ask "how many messages happened in the last
// N days" directly -- this fetches up to 100 recent messages per
// channel (Discord's per-request max) and counts how many fall inside
// this window. A channel with more than 100 messages in 7 days will be
// undercounted -- known and accepted limitation of the polling approach,
// not a bug.
const MESSAGE_LOOKBACK_DAYS = 7;
const MAX_CHANNELS_SAMPLED = 5;
const MAX_MESSAGES_PER_FETCH = 100;
const RATE_LIMIT_COURTESY_DELAY_MS = 300;

async function fetchGuildChannels(guildId, botToken) {
  const res = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `channel list fetch failed (${res.status})`);
  }
  return res.json();
}

async function fetchRecentMessages(channelId, botToken) {
  const res = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages?limit=${MAX_MESSAGES_PER_FETCH}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  // 403 = bot lacks access to this specific channel (per-channel
  // permission overwrite denying it); 404 = channel deleted since the
  // guild's channel list was fetched. Neither is fatal for the whole
  // guild -- just skip this one channel and keep going.
  if (res.status === 403 || res.status === 404) return [];
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `messages fetch failed (${res.status})`);
  }
  return res.json();
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function countRecentMessages(guildId, botToken) {
  const channels = await fetchGuildChannels(guildId, botToken);
  // type === 0 is GUILD_TEXT. Take the first few text channels returned
  // -- Discord doesn't return channels pre-sorted by activity, so this
  // is a sample of convenience, not necessarily the most active
  // channels. A more thorough version would need to try more channels;
  // capped low here to keep the daily API call volume small.
  const textChannels = channels.filter((c) => c.type === 0).slice(0, MAX_CHANNELS_SAMPLED);

  const cutoffMs = Date.now() - MESSAGE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  let totalMessages = 0;
  let channelsSuccessfullyRead = 0;

  for (const channel of textChannels) {
    const messages = await fetchRecentMessages(channel.id, botToken);
    if (messages.length > 0) channelsSuccessfullyRead++;
    for (const msg of messages) {
      if (new Date(msg.timestamp).getTime() >= cutoffMs) totalMessages++;
    }
    await sleep(RATE_LIMIT_COURTESY_DELAY_MS);
  }

  return { totalMessages, channelsAttempted: textChannels.length, channelsSuccessfullyRead };
}

module.exports = async function handleDiscordPoll(req, res) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    console.error('cron-discord-poll: DISCORD_BOT_TOKEN not set, skipping');
    return res.status(200).json({ skipped: true, reason: 'DISCORD_BOT_TOKEN not configured' });
  }

  const admin = adminClient();
  const { data: connections, error } = await admin
    .from('platform_connections')
    .select('id, creator_id, guild_id, follower_count')
    .eq('platform', 'discord')
    .eq('verification_method', 'oauth')
    .not('guild_id', 'is', null);

  if (error) {
    console.error('cron-discord-poll: could not load connections', error);
    return res.status(500).json({ error: error.message });
  }

  let processed = 0;
  let failed = 0;

  for (const conn of connections || []) {
    try {
      const { totalMessages, channelsAttempted, channelsSuccessfullyRead } =
        await countRecentMessages(conn.guild_id, botToken);

      const avgPerMember = conn.follower_count > 0 ? totalMessages / conn.follower_count : null;

      await admin.from('platform_connections').update({
        avg_messages_per_member: avgPerMember,
        message_sample_size: totalMessages,
        message_poll_error: channelsAttempted > 0 && channelsSuccessfullyRead === 0
          ? 'Bot could not read any channels in this server -- check it has View Channel + Read Message History permission.'
          : null,
      }).eq('id', conn.id);

      processed++;
    } catch (err) {
      console.error(`cron-discord-poll: failed for connection ${conn.id}:`, err.message);
      await admin.from('platform_connections').update({
        message_poll_error: err.message,
      }).eq('id', conn.id);
      failed++;
    }
  }

  return res.status(200).json({ processed, failed, total: (connections || []).length });
};
