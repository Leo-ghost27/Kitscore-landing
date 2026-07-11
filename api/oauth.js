// GET/POST /api/tiktok-oauth and /api/youtube-oauth-callback both land
// here -- see the two rewrites in vercel.json. This merges what were
// two separate serverless functions (api/tiktok-oauth.js and
// api/youtube-oauth-callback.js, each already a start+callback merge
// of their own -- see their git history) into one, freeing a slot
// under Vercel's Hobby plan function-count cap.
//
// Critically, this does NOT change either provider's registered
// redirect_uri. TikTok's Redirect URI field rejects any URI containing
// query parameters, and Google's must match exactly what's registered
// in Google Cloud Console -- so both external URLs must stay exactly
// as-is (https://kitscore.co/api/tiktok-oauth and
// https://kitscore.co/api/youtube-oauth-callback, no query string as
// far as TikTok/Google are concerned). The rewrite in vercel.json
// appends ?provider=tiktok|youtube server-side, invisible to the
// external request -- Vercel resolves it to this one function file
// before TikTok/Google's redirect is ever seen by application code.
//
// Within each provider, dispatch is still by HTTP method, same
// reasoning as the two original files: `start` is POSTed by the
// authenticated frontend (returns an authorize URL to navigate to);
// `callback` is the provider's own GET redirect after the creator
// approves/denies access (no auth header available; ties back to a
// creator via the oauth_states row written during `start`).
//
// Both are the OWNERSHIP-VERIFIED counterpart to /api/connect-platform's
// public_lookup linking -- see supabase/2026-07-09-platform-
// connections.sql for why that distinction (verification_method:
// 'oauth' vs 'public_lookup') matters for Confidence and Engagement
// Quality.
const tiktokStart = require('../lib/handlers/tiktok-oauth-start');
const tiktokCallback = require('../lib/handlers/tiktok-oauth-callback');
const youtubeStart = require('../lib/handlers/youtube-oauth-start');
const youtubeCallback = require('../lib/handlers/youtube-oauth-callback');

module.exports = async (req, res) => {
  const provider = req.query?.provider;
  const action = req.query?.action;
  const isCallbackRequest = req.query?.code || req.query?.state || req.query?.error || action === 'callback';

  if (provider === 'tiktok') {
    if (req.method === 'POST' || action === 'start') return tiktokStart(req, res);
    if (req.method === 'GET' && isCallbackRequest) return tiktokCallback(req, res);
  } else if (provider === 'youtube') {
    if (req.method === 'POST' || action === 'start') return youtubeStart(req, res);
    if (req.method === 'GET' && isCallbackRequest) return youtubeCallback(req, res);
  } else {
    // Reachable directly at /api/oauth with no provider -- shouldn't
    // happen via the app, only via the tiktok-oauth/youtube-oauth-callback
    // rewrites, but stay safe rather than 500.
    return res.status(400).json({ error: 'Missing or unknown provider.' });
  }

  return res.status(400).json({ error: 'Unknown or missing action. Use ?action=start (POST) or let the provider redirect here with code/state (GET).' });
};
