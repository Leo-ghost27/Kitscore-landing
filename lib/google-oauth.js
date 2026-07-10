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
  const params = new URLSearchParams({ part: 'snippet,statistics', mine: 'true' });
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
  };
}

function generateState() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  fetchOwnYoutubeChannel,
  generateState,
};
