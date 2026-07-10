// POST /api/youtube-oauth-callback (start) | GET /api/youtube-oauth-callback (callback, from Google)
// Google OAuth 2.0 entry point for ownership-verified YouTube connections.
// One file for both legs of the flow, same reasoning as api/tiktok-oauth.js
// (see that file for the full writeup) -- keeps the registered redirect_uri
// stable and avoids burning an extra serverless function slot on Vercel's
// Hobby plan.
//
// Unlike TikTok, Google's redirect_uri field tolerates query params, so
// this could have been routed by ?action= alone -- but it's dispatched by
// HTTP method here too, for consistency with tiktok-oauth.js and because
// `start` (authenticated, POSTed by the frontend) and `callback` (Google's
// own GET redirect, no auth header available) are naturally different
// verbs anyway.
//
// This is the OWNERSHIP-VERIFIED counterpart to /api/connect-platform's
// public_lookup YouTube linking -- see supabase/2026-07-09-platform-
// connections.sql and lib/google-oauth.js for why that distinction
// (verification_method: 'oauth' vs 'public_lookup') matters for
// Confidence and Engagement Quality, and how completing this flow upgrades
// an existing public_lookup row rather than creating a duplicate.
const handleStart = require('../lib/handlers/youtube-oauth-start');
const handleCallback = require('../lib/handlers/youtube-oauth-callback');

module.exports = async (req, res) => {
  const action = req.query?.action;

  if (req.method === 'POST' || action === 'start') return handleStart(req, res);
  if (req.method === 'GET' && (req.query?.code || req.query?.state || req.query?.error || action === 'callback')) {
    return handleCallback(req, res);
  }

  return res.status(400).json({ error: 'Unknown or missing action. Use ?action=start (POST) or let Google redirect here with code/state (GET).' });
};
