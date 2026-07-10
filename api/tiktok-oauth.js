// POST /api/tiktok-oauth (start) | GET /api/tiktok-oauth (callback, from TikTok)
// TikTok Login Kit OAuth 2.0 entry point. Merges what would otherwise be
// two standalone routes into one, matching the July 2026 API-route
// consolidation (see api/billing.js for the full reasoning -- Vercel's
// Hobby plan caps serverless function count).
//
// Routed by HTTP method, not a query param: TikTok's Redirect URI field
// rejects any URI containing query parameters, so the registered
// redirect_uri must be the bare path with nothing appended. TikTok's own
// callback redirect is always a GET (with code/state/error appended by
// TikTok itself), while `start` is always POSTed by the authenticated
// frontend (returns an authorize URL to navigate to). This method-based
// routing keeps the registered redirect_uri clean while still supporting
// both legs of the flow from one function.
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

  // Explicit ?action= still works for manual testing, but the real
  // dispatch TikTok and the frontend rely on is HTTP method.
  if (req.method === 'POST' || action === 'start') return handleStart(req, res);
  if (req.method === 'GET' && (req.query?.code || req.query?.state || req.query?.error || action === 'callback')) {
    return handleCallback(req, res);
  }

  return res.status(400).json({ error: 'Unknown or missing action. Use ?action=start (POST) or let TikTok redirect here with code/state (GET).' });
};
