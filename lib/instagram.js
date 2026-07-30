// Server-only. Instagram OAuth helpers, using the "Instagram API with
// Instagram Login" flow (api.instagram.com / graph.instagram.com) --
// NOT the older Facebook Login for Business flow. This is the
// standalone path Meta introduced so a creator can connect an
// Instagram professional (Business or Creator) account directly,
// without also needing a linked Facebook Page. Matches what the app
// dashboard screenshot (App ID + secret, no Page requirement) implies
// is set up on the Meta side.
//
// Scoped to instagram_business_basic only -- the minimum needed for
// ownership proof (a successful /me call using the token is itself
// proof of ownership, same reasoning as lib/twitch.js) plus the
// profile fields used for scoring (username, media_count,
// followers_count). No content-publishing, messaging, or comments
// scopes requested.
//
// Three-step token flow, unlike Twitch/TikTok/YouTube's one-step
// exchange:
//   1. exchangeCodeForToken -- code -> short-lived token (1 hour)
//   2. exchangeForLongLivedToken -- short-lived -> long-lived token (~60 days)
//   3. fetchInstagramOwnUser -- long-lived token -> profile fields
// Steps 1+2 both happen inside instagram-oauth-callback.js so only the
// long-lived token is ever persisted to platform_connections.

const crypto = require('crypto');

const IG_AUTH_URL = 'https://www.instagram.com/oauth/authorize';
const IG_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const IG_LONG_LIVED_URL = 'https://graph.instagram.com/access_token';
const IG_GRAPH_ME_URL = 'https://graph.instagram.com/v21.0/me';

// instagram_business_basic -- profile identity + public counts only.
// Deliberately does not request instagram_business_content_publish,
// instagram_business_manage_messages, or instagram_business_manage_comments
// -- same least-privilege reasoning as the Twitch scope choice in lib/twitch.js.
const SCOPES = 'instagram_business_basic';

function buildAuthorizeUrl({ state, redirectUri }) {
  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  if (!clientId) throw new Error('INSTAGRAM_CLIENT_ID is not configured');
  if (!redirectUri) throw new Error('redirectUri is required');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    response_type: 'code',
    state,
  });
  return `${IG_AUTH_URL}?${params.toString()}`;
}

// Step 1: code -> short-lived token. Instagram's token endpoint wants
// multipart/form-data or x-www-form-urlencoded -- form-urlencoded works
// fine and matches the other providers' calls in this file's siblings.
async function exchangeCodeForToken({ code, redirectUri }) {
  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('INSTAGRAM_CLIENT_ID / INSTAGRAM_CLIENT_SECRET are not configured');
  }

  const res = await fetch(IG_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error_message) {
    // Error only, never token values -- same pattern as lib/twitch.js.
    console.error('[instagram] short-lived token exchange failed', {
      status: res.status,
      redirectUri,
      clientIdPrefix: (clientId || '').slice(0, 6),
      error: data.error_message || data.error,
    });
    throw new Error(data.error_message || `Instagram token exchange failed (${res.status})`);
  }
  // { access_token, user_id, permissions } -- short-lived, ~1 hour.
  return data;
}

// Step 2: short-lived -> long-lived token (~60 days). GET request with
// the short-lived token and client_secret as query params -- no client_id
// on this call, which is easy to miss if copying the pattern from step 1.
async function exchangeForLongLivedToken(shortLivedToken) {
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
  if (!clientSecret) throw new Error('INSTAGRAM_CLIENT_SECRET is not configured');

  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: clientSecret,
    access_token: shortLivedToken,
  });
  const res = await fetch(`${IG_LONG_LIVED_URL}?${params.toString()}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error((data.error && data.error.message) || `Instagram long-lived token exchange failed (${res.status})`);
  }
  // { access_token, token_type, expires_in } -- expires_in is seconds (~5184000 = 60 days).
  return data;
}

// Refreshes a long-lived token before it expires (must be done before
// expiry, and the token must already be at least 24h old) -- extends it
// another ~60 days. Same shape as the Twitch refresh, but Instagram's
// long-lived tokens use this dedicated refresh endpoint rather than a
// refresh_token grant.
async function refreshLongLivedToken(longLivedToken) {
  const params = new URLSearchParams({
    grant_type: 'ig_refresh_token',
    access_token: longLivedToken,
  });
  const res = await fetch(`${IG_LONG_LIVED_URL}?${params.toString()}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error((data.error && data.error.message) || `Instagram token refresh failed (${res.status})`);
  }
  return data; // { access_token, token_type, expires_in }
}

// Get the authenticated user's own profile -- id, username, account
// type, and (with instagram_business_basic) media_count and
// followers_count. No extra scope needed beyond the token itself.
async function fetchInstagramOwnUser(accessToken) {
  const params = new URLSearchParams({
    fields: 'id,username,account_type,media_count,followers_count',
    access_token: accessToken,
  });
  const res = await fetch(`${IG_GRAPH_ME_URL}?${params.toString()}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error((data.error && data.error.message) || `Instagram profile fetch failed (${res.status})`);
  }
  return data; // { id, username, account_type, media_count, followers_count }
}

function generateState() {
  return crypto.randomBytes(24).toString('hex');
}

// media edge, not the /me profile fields -- confirmed via Meta's current
// docs that instagram_business_basic already covers this (it's the same
// scope already requested above, not a new one), so this needs no new
// consent from creators who already connected. Only need `timestamp` for
// content-consistency purposes; kept the request minimal rather than
// pulling caption/media_url/etc. we don't use here.
const IG_GRAPH_MEDIA_URL = 'https://graph.instagram.com/v21.0/me/media';

async function fetchInstagramMedia(accessToken) {
  const params = new URLSearchParams({
    fields: 'id,timestamp',
    limit: '50', // most-recent-first by default; 50 comfortably covers an 8-week window for any account posting more than ~1x/week
    access_token: accessToken,
  });
  const res = await fetch(`${IG_GRAPH_MEDIA_URL}?${params.toString()}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error((data.error && data.error.message) || `Instagram media fetch failed (${res.status})`);
  }
  return data.data || []; // [{ id, timestamp }, ...]
}

// Same banding thresholds as computeContentConsistency in google-oauth.js
// (active-weeks-out-of-trailing-8), duplicated rather than shared to
// avoid touching the already-working YouTube path for this change --
// see the per-platform content-consistency review in chat. Instagram's
// `timestamp` field is an ISO string same as YouTube's `publishedAt`, so
// the logic itself needed no adaptation, only the field name.
function computeContentConsistency(media) {
  if (!media || media.length === 0) return null;

  const now = Date.now();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const activeWeeks = new Set();

  for (const m of media) {
    if (!m.timestamp) continue;
    const postedMs = new Date(m.timestamp).getTime();
    const weeksAgo = Math.floor((now - postedMs) / WEEK_MS);
    if (weeksAgo >= 0 && weeksAgo < 8) activeWeeks.add(weeksAgo);
  }

  const count = activeWeeks.size;
  if (count >= 6) return 90;
  if (count >= 4) return 75;
  if (count >= 2) return 55;
  if (count >= 1) return 35;
  return 20;
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  refreshLongLivedToken,
  fetchInstagramOwnUser,
  fetchInstagramMedia,
  computeContentConsistency,
  generateState,
};
