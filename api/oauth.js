// GET/POST /api/tiktok-oauth, /api/youtube-oauth-callback, and
// /api/twitch-oauth all land here -- see the three rewrites in
// vercel.json. This merges what would otherwise be separate serverless
// functions per provider into one, staying under Vercel's Hobby plan
// function-count cap.
//
// Critically, this does NOT change any provider's registered
// redirect_uri. TikTok's Redirect URI field rejects any URI containing
// query parameters, and Google's/Twitch's must match exactly what's
// registered in their respective developer consoles -- so all external
// URLs stay exactly as-is (https://kitscore.co/api/tiktok-oauth,
// https://kitscore.co/api/youtube-oauth-callback,
// https://kitscore.co/api/twitch-oauth -- no query string as far as any
// provider is concerned). The rewrite in vercel.json appends
// ?provider=tiktok|youtube|twitch server-side, invisible to the
// external request -- Vercel resolves it to this one function file
// before the provider's redirect is ever seen by application code.
//
// Within each provider, dispatch is still by HTTP method, same
// reasoning as the original files: `start` is POSTed by the
// authenticated frontend (returns an authorize URL to navigate to);
// `callback` is the provider's own GET redirect after the creator
// approves/denies access (no auth header available; ties back to a
// creator via the oauth_states row written during `start`).
//
// All three are the OWNERSHIP-VERIFIED counterpart to
// /api/connect-platform's public_lookup linking -- see
// supabase/2026-07-09-platform-connections.sql for why that distinction
// (verification_method: 'oauth' vs 'public_lookup') matters for
// Confidence and Engagement Quality.
const tiktokStart = require('../lib/handlers/tiktok-oauth-start');
const tiktokCallback = require('../lib/handlers/tiktok-oauth-callback');
const youtubeStart = require('../lib/handlers/youtube-oauth-start');
const youtubeCallback = require('../lib/handlers/youtube-oauth-callback');
const twitchStart = require('../lib/handlers/twitch-oauth-start');
const twitchCallback = require('../lib/handlers/twitch-oauth-callback');

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
  } else if (provider === 'twitch') {
    if (req.method === 'POST' || action === 'start') return twitchStart(req, res);
    if (req.method === 'GET' && isCallbackRequest) return twitchCallback(req, res);
  } else {
    // Reachable directly at /api/oauth with no provider -- shouldn't
    // happen via the app, only via the tiktok-oauth/youtube-oauth-callback
    // rewrites, but stay safe rather than 500.
    return res.status(400).json({ error: 'Missing or unknown provider.' });
  }

  return res.status(400).json({ error: 'Unknown or missing action. Use ?action=start (POST) or let the provider redirect here with code/state (GET).' });
};
