// Server-only. Discord OAuth 2.0 helpers: authorize-URL construction,
// code -> token exchange, and user/guild-ownership fetch.
//
// Scoped to `identify guilds` only. `guilds` (with with_counts=true) is
// the one thing OAuth is needed for -- it returns every guild the user
// is in, each with an `owner` boolean and approximate_member_count. That
// gives us the exact same two things Twitch's moderator:read:followers
// scope gives us: ownership proof (the creator owns the server, not
// just a member of it) and a size signal (member count), from a single
// least-privilege scope. No email or other scope requested -- same
// least-privilege lesson as the Twitch/YouTube scope choices.
//
// Unlike Twitch, Discord does not require a separate Client-Id header --
// the Bearer token alone is sufficient for both endpoints used here.

const crypto = require('crypto');

const DISCORD_AUTH_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_USERS_ME_URL = 'https://discord.com/api/users/@me';
const DISCORD_USERS_ME_GUILDS_URL = 'https://discord.com/api/users/@me/guilds';
// identify -- username/id, used purely to key the platform_connections row.
// guilds -- list of guilds the user is in, each with `owner` and (via
// with_counts=true on the request) approximate_member_count. This is
// the ownership + size signal; nothing else is requested.
const SCOPES = 'identify guilds';

function buildAuthorizeUrl({ state, redirectUri }) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) throw new Error('DISCORD_CLIENT_ID is not configured');
  if (!redirectUri) throw new Error('redirectUri is required');

  const params = new URLSearchParams({
    client_id: clientId,
    scope: SCOPES,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    prompt: 'consent',
  });
  return `${DISCORD_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForToken({ code, redirectUri }) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET are not configured');
  }

  const res = await fetch(DISCORD_TOKEN_URL, {
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
    // Error only, never token values -- same pattern as lib/twitch.js.
    console.error('[discord] token exchange failed', {
      status: res.status,
      redirectUri,
      clientIdPrefix: (clientId || '').slice(0, 6),
      error: data.error,
      error_description: data.error_description,
    });
    throw new Error(data.error_description || data.error || `Discord token exchange failed (${res.status})`);
  }
  // { access_token, token_type, expires_in, refresh_token, scope }
  return data;
}

async function refreshAccessToken(refreshToken) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET are not configured');
  }

  const res = await fetch(DISCORD_TOKEN_URL, {
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
    throw new Error(data.error_description || data.error || `Discord token refresh failed (${res.status})`);
  }
  return data;
}

// Get Current User -- used purely to key the platform_connections row
// (platform_user_id / platform_handle). No extra scope needed beyond
// `identify`.
async function fetchDiscordOwnUser(accessToken) {
  const res = await fetch(DISCORD_USERS_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok || !data.id) {
    throw new Error(data.message || `Discord user fetch failed (${res.status})`);
  }
  // Discord merged username#discriminator into a single `username` for
  // most accounts now (2023 username migration) -- global_name is the
  // display name when set, fall back to username.
  return data; // { id, username, global_name, discriminator, avatar, ... }
}

// Get Current User Guilds (with_counts=true) -- returns every guild the
// token's user belongs to, each with `owner` (bool) and, because of
// with_counts, approximate_member_count / approximate_presence_count.
// We only care about guilds where owner === true -- same ownership
// reasoning as Twitch's broadcaster_id-must-match-token check: a
// non-owner has no server-level signal worth attaching to their score.
// Returns the single largest owned guild by member count, or null if
// the creator doesn't own any server they authorized.
async function fetchDiscordOwnedGuild(accessToken) {
  const params = new URLSearchParams({ with_counts: 'true' });
  const res = await fetch(`${DISCORD_USERS_ME_GUILDS_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || `Discord guilds fetch failed (${res.status})`);
  }
  if (!Array.isArray(data)) return null;

  const owned = data.filter((g) => g.owner === true);
  if (owned.length === 0) return null;

  owned.sort((a, b) => (b.approximate_member_count || 0) - (a.approximate_member_count || 0));
  return owned[0]; // { id, name, owner, approximate_member_count, approximate_presence_count, ... }
}

function generateState() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  fetchDiscordOwnUser,
  fetchDiscordOwnedGuild,
  generateState,
};
