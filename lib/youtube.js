// Server-only. Fetches PUBLIC YouTube channel stats via the YouTube Data
// API v3 using an API key -- no OAuth, no app review, works today. This
// only ever returns numbers that are publicly visible on the channel page
// (subscriber/view/video count) -- it proves nothing about who owns the
// channel. See supabase/2026-07-09-platform-connections.sql for why that
// distinction (verification_method = 'public_lookup' vs 'oauth') matters
// and must be preserved in any UI that surfaces this data.

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

// Accepts either a raw channel ID (starts "UC", 24 chars) or an @handle.
// The Data API takes a different query param for each -- creators will
// almost always give us their @handle (what they actually know), so that's
// tried by default; a channel ID is detected and used directly if given.
async function fetchYoutubeChannelStats(handleOrId) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is not configured');

  const raw = (handleOrId || '').trim();
  if (!raw) throw new Error('handleOrId is required');

  const isChannelId = /^UC[\w-]{22}$/.test(raw);
  const cleanHandle = raw.replace(/^@/, '');

  const param = isChannelId
    ? `id=${encodeURIComponent(raw)}`
    : `forHandle=${encodeURIComponent(cleanHandle)}`;

  const url = `${YOUTUBE_API_BASE}/channels?part=snippet,statistics&${param}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error?.message || `YouTube API error (${res.status})`);
  }

  const channel = data.items?.[0];
  if (!channel) return null;

  // hiddenSubscriberCount is true when the creator has hidden their count
  // on YouTube itself -- in that case subscriberCount is not meaningful
  // (YouTube still returns a stale/zero value), so surface null instead of
  // a misleading number.
  const hidden = channel.statistics?.hiddenSubscriberCount === true;

  return {
    channelId: channel.id,
    title: channel.snippet?.title || null,
    handle: channel.snippet?.customUrl || null,
    subscriberCount: hidden ? null : Number(channel.statistics?.subscriberCount ?? 0),
    viewCount: Number(channel.statistics?.viewCount ?? 0),
    videoCount: Number(channel.statistics?.videoCount ?? 0),
  };
}

module.exports = { fetchYoutubeChannelStats };
