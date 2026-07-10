// Server-only. TikTok Login Kit OAuth 2.0 helpers: authorize-URL
// construction, code -> token exchange, and a basic user-info fetch.
//
// Scoped to user.info.basic only for now (display name, avatar, verified
// flag) -- that's enough to prove account ownership, which is the actual
// goal of this flow (see verification_method = 'oauth' in
// supabase/2026-07-09-platform-connections.sql). Deeper scopes
// (video.list, follower counts, etc.) need a separate TikTok approval
// request beyond basic Login Kit and aren't wired up here -- requesting
// them before that approval exists will just fail at TikTok's end.

const crypto = require('crypto');

const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_USERINFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const SCOPES = 'user.info.basic';

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
  const fields = 'open_id,union_id,avatar_url,display_name,is_verified';
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
