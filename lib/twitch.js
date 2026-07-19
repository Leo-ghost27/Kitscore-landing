// Server-only. Twitch OAuth 2.0 helpers: authorize-URL construction,
// code -> token exchange, and user/follower-count fetch.
//
// Scoped to moderator:read:followers only. This is the one thing OAuth
// is needed for -- Twitch requires this scope even to read a creator's
// own follower count (a 2023 API change), and it's also what proves
// ownership: the broadcaster_id in the Get Channel Followers call must
// match the user ID in the access token (or that user must be a
// moderator for the channel), so a successful call is itself proof the
// signed-in user controls the channel. No email or other scope requested
// -- same least-privilege lesson as the YouTube scope rejection.
//
// Unlike TikTok/YouTube, every Twitch Helix API call requires BOTH the
// Bearer token AND a Client-Id header -- easy to miss, causes a 401 if
// omitted even with a perfectly valid token.

const crypto = require('crypto');

const TWITCH_AUTH_URL = 'https://id.twitch.tv/oauth2/authorize';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_USERS_URL = 'https://api.twitch.tv/helix/users';
const TWITCH_FOLLOWERS_URL = 'https://api.twitch.tv/helix/channels/followers';
const SCOPES = 'moderator:read:followers';

function buildAuthorizeUrl({ state, redirectUri }) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!clientId) throw new Error('TWITCH_CLIENT_ID is not configured');
  if (!redirectUri) throw new Error('redirectUri is required');

  const params = new URLSearchParams({
    client_id: clientId,
    scope: SCOPES,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
  });
  return `${TWITCH_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForToken({ code, redirectUri }) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are not configured');
  }

  const res = await fetch(TWITCH_TOKEN_URL, {
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
    // Error only, never token values -- same pattern as lib/tiktok.js
    // after the log-leak fix.
    console.error('[twitch] token exchange failed', {
      status: res.status,
      redirectUri,
      clientIdPrefix: (clientId || '').slice(0, 6),
      error: data.error,
      error_description: data.message || data.error_description,
    });
    throw new Error(data.message || data.error_description || data.error || `Twitch token exchange failed (${res.status})`);
  }
  // { access_token, expires_in, refresh_token, scope, token_type }
  return data;
}

async function refreshAccessToken(refreshToken) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET are not configured');
  }

  const res = await fetch(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.message || data.error_description || data.error || `Twitch token refresh failed (${res.status})`);
  }
  return data;
}

// Get Users -- the authenticated user's own profile. No extra scope
// needed beyond a valid token; used here purely to get their user id
// (== broadcaster_id) and display name/login.
async function fetchTwitchOwnUser(accessToken) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const res = await fetch(TWITCH_USERS_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': clientId,
    },
  });
  const data = await res.json();
  if (!res.ok || !data.data || !data.data[0]) {
    throw new Error(data.message || `Twitch user fetch failed (${res.status})`);
  }
  return data.data[0]; // { id, login, display_name, ... }
}

// Get Channel Followers -- total count only (we don't need or store the
// individual follower list). Requires moderator:read:followers and the
// broadcaster_id to match the token's own user id, which is exactly the
// ownership proof this integration relies on.
async function fetchTwitchFollowerCount(accessToken, broadcasterId) {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const params = new URLSearchParams({ broadcaster_id: broadcasterId, first: '1' });
  const res = await fetch(`${TWITCH_FOLLOWERS_URL}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': clientId,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `Twitch follower count fetch failed (${res.status})`);
  }
  return typeof data.total === 'number' ? data.total : null;
}

function generateState() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  fetchTwitchOwnUser,
  fetchTwitchFollowerCount,
  generateState,
};
