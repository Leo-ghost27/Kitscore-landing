// Server-only. Google OAuth 2.0 helpers for ownership-verified YouTube
// connections: authorize-URL construction, code -> token exchange, token
// refresh, and a "my channel" fetch.
//
// This is the OWNERSHIP-VERIFIED counterpart to lib/youtube.js's
// fetchYoutubeChannelStats (public API-key lookup, no OAuth, proves
// nothing about ownership). Once a creator completes this flow we know
// they actually signed in to the Google account that owns the channel --
// see verification_method: 'oauth' vs 'public_lookup' in
// supabase/2026-07-09-platform-connections.sql. Same distinction TikTok's
// lib/tiktok.js draws, and the same file shape on purpose.
//
// Scoped to youtube.readonly only -- enough to read the signed-in user's
// own channel (id/snippet/statistics via channels?mine=true). No upload,
// no write access, nothing beyond proving + describing the channel.

const crypto = require('crypto');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';
const SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';

function buildAuthorizeUrl({ state, redirectUri }) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not configured');
  if (!redirectUri) throw new Error('redirectUri is required');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
    // offline + consent so we reliably get a refresh_token, including on
    // a reconnect where Google would otherwise skip re-issuing one.
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForToken({ code, redirectUri }) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured');
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || `Google token exchange failed (${res.status})`);
  }
  // { access_token, expires_in, refresh_token, scope, token_type, id_token }
  // Note: refresh_token is only present on first consent (or with
  // prompt=consent, on every consent) -- never overwrite a stored
  // refresh_token with undefined on a later refresh-token grant call.
  return data;
}

async function refreshAccessToken(refreshToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured');
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || `Google token refresh failed (${res.status})`);
  }
  return data;
}

// Fetches the signed-in user's own channel -- mine=true scopes the query
// to whichever channel the just-granted access_token belongs to, which is
// exactly the proof of ownership this flow exists for.
async function fetchOwnYoutubeChannel(accessToken) {
  const params = new URLSearchParams({ part: 'snippet,statistics,contentDetails', mine: 'true' });
  const res = await fetch(`${YOUTUBE_CHANNELS_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `YouTube channel fetch failed (${res.status})`);
  }

  const channel = data.items?.[0];
  if (!channel) throw new Error('No YouTube channel found for this Google account');

  const hidden = channel.statistics?.hiddenSubscriberCount === true;

  return {
    channelId: channel.id,
    title: channel.snippet?.title || null,
    handle: channel.snippet?.customUrl || null,
    subscriberCount: hidden ? null : Number(channel.statistics?.subscriberCount ?? 0),
    viewCount: Number(channel.statistics?.viewCount ?? 0),
    videoCount: Number(channel.statistics?.videoCount ?? 0),
    uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads || null,
  };
}

// Lists the creator's own uploads (title/description/publishedAt) via their
// channel's uploads playlist. Still within youtube.readonly -- this is a
// read of the same public-facing metadata a viewer sees on the channel
// page, just fetched in bulk instead of scraped one video at a time.
// Paginates up to maxResults (default 50, ~1 API call per 50 videos) --
// plenty for both a posting-cadence calculation (content_consistency) and
// a title/description text scan (brand_safety), the two features this
// was built for. Not used for anything beyond those -- no view/like counts
// per video, no comments, nothing outside what channels.list already
// covers in aggregate.
async function fetchYoutubeUploads(accessToken, uploadsPlaylistId, maxResults = 50) {
  if (!uploadsPlaylistId) return [];

  const videos = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      part: 'snippet',
      playlistId: uploadsPlaylistId,
      maxResults: String(Math.min(50, maxResults - videos.length)),
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `YouTube uploads fetch failed (${res.status})`);
    }

    for (const item of data.items || []) {
      videos.push({
        videoId: item.snippet?.resourceId?.videoId || null,
        title: item.snippet?.title || null,
        description: item.snippet?.description || null,
        publishedAt: item.snippet?.publishedAt || null,
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken && videos.length < maxResults);

  return videos;
}

// Grades posting cadence over the trailing 8 weeks -- how many distinct
// weeks had at least one upload. Deliberately simple/explainable (a
// sponsor or creator can recount it by hand from the video list) rather
// than a fancier regularity/variance formula. Returns null (not "0") when
// there's no video data at all, so the caller can skip writing a score
// component instead of unfairly zeroing out a creator with nothing to
// measure yet -- same null-guard pattern as fn_recalc_engagement_quality.
function computeContentConsistency(videos) {
  if (!videos || videos.length === 0) return null;

  const now = Date.now();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const activeWeeks = new Set();

  for (const v of videos) {
    if (!v.publishedAt) continue;
    const publishedMs = new Date(v.publishedAt).getTime();
    const weeksAgo = Math.floor((now - publishedMs) / WEEK_MS);
    if (weeksAgo >= 0 && weeksAgo < 8) activeWeeks.add(weeksAgo);
  }

  const count = activeWeeks.size;
  if (count >= 6) return 90;
  if (count >= 4) return 75;
  if (count >= 2) return 55;
  if (count >= 1) return 35;
  return 20; // has upload history, just none in the last 8 weeks
}

function generateState() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  fetchOwnYoutubeChannel,
  fetchYoutubeUploads,
  computeContentConsistency,
  generateState,
};
