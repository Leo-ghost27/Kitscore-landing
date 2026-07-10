// POST /api/tiktok-oauth?action=start | GET /api/tiktok-oauth?action=callback
// TikTok Login Kit OAuth 2.0 entry point. Merges what would otherwise be
// two standalone routes into one, matching the July 2026 API-route
// consolidation (see api/billing.js for the full reasoning -- Vercel's
// Hobby plan caps serverless function count).
//
// `start` is POSTed by the frontend (authenticated, returns an authorize
// URL to navigate to). `callback` is GETed by TikTok's own redirect after
// the creator approves/denies access (no auth header available; ties back
// to a creator via the oauth_states row written during `start`).
//
// This is the OWNERSHIP-VERIFIED counterpart to /api/connect-platform's
// public_lookup YouTube linking -- see supabase/2026-07-09-platform-
// connections.sql and 2026-07-10-dedupe-cap-and-gate-engagement-quality.sql
// for why that distinction (verification_method: 'oauth' vs
// 'public_lookup') matters for Confidence and Engagement Quality.
const handleStart = require('../lib/handlers/tiktok-oauth-start');
const handleCallback = require('../lib/handlers/tiktok-oauth-callback');

module.exports = async (req, res) => {
  const action = req.query?.action;

  if (action === 'start') return handleStart(req, res);
  if (action === 'callback') return handleCallback(req, res);

  return res.status(400).json({ error: 'Unknown or missing action. Use ?action=start or ?action=callback.' });
};
