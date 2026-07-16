// Server-only. TikTok Login Kit OAuth 2.0 helpers: authorize-URL
// construction, code -> token exchange, and a basic user-info fetch.
//
// Scoped to user.info.basic (ownership proof: display name, avatar --
// see verification_method = 'oauth' in
// supabase/2026-07-09-platform-connections.sql) plus user.info.stats
// (follower_count, video_count -- same fields YouTube's OAuth flow
// stores via google-oauth.js's fetchOwnYoutubeChannel). Both scopes
// must be added under Login Kit in the TikTok Developer Portal or the
// authorize step itself will reject with scope_not_authorized.
//
// Accounts that connected before user.info.stats was added need to hit
// "Reconnect" -- an existing token only carries the scopes it was
// originally granted with, so this doesn't retroactively apply.

const crypto = require('crypto');

const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_USERINFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const SCOPES = 'user.info.basic,user.info.stats';

function buildAuthorizeUrl({ state, redirectUri }) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey) throw new Error('TIKTOK_CLIENT_KEY is not configured');
  if (!redirectUri) throw new Error('redirectUri is required');

  const params = new URLSearchParams({
    client_key: clientKey,
    scope: SCOPES,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
  });
  return `${TIKTOK_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForToken({ code, redirectUri }) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new Error('TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not configured');
  }

  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  const data = await res.json();
  // TEMP DIAGNOSTIC (remove after debugging) -- logs TikTok's raw response
  // (never logs client_secret) so we can see the real error/log_id instead
  // of just the generic error_description string.
  console.error('[tiktok-diag] token endpoint response', {
    status: res.status,
    redirectUri,
    clientKeyPrefix: (clientKey || '').slice(0, 6),
    body: data,
  });
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || `TikTok token exchange failed (${res.status})`);
  }
  // { access_token, expires_in, open_id, refresh_token, refresh_expires_in, scope, token_type }
  return data;
}

async function refreshAccessToken(refreshToken) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new Error('TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not configured');
  }

  const res = await fetch(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || `TikTok token refresh failed (${res.status})`);
  }
  return data;
}

async function fetchTiktokUserInfo(accessToken) {
  // NOTE: is_verified deliberately excluded -- TikTok's 2024 scope
  // migration moved it behind user.info.profile, which this app doesn't
  // request (SCOPES above is user.info.basic only). Requesting it here
  // causes the whole /v2/user/info/ call to fail with scope_not_authorized
  // even after a successful token exchange, since it's an all-or-nothing
  // fields param. It isn't used by the callback handler anyway.
  const fields = 'open_id,union_id,avatar_url,display_name,follower_count,video_count,likes_count';
  const res = await fetch(`${TIKTOK_USERINFO_URL}?fields=${fields}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok || (data.error && data.error.code !== 'ok')) {
    throw new Error(data.error?.message || `TikTok user info fetch failed (${res.status})`);
  }
  return data.data.user;
}

function generateState() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  fetchTiktokUserInfo,
  generateState,
};
