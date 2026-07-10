// Handler for POST /api/tiktok-oauth?action=start
// Authenticated creator only. Returns a TikTok authorize URL for the
// frontend to navigate to (window.location = authorizeUrl) -- not a
// server-side redirect itself, because this needs to be reached with a
// Bearer token (same auth pattern as every other endpoint in this repo),
// and a plain top-level browser navigation can't carry that header. The
// frontend does an authenticated fetch here first, then navigates.
//
// The returned `state` is recorded in oauth_states before responding so
// the callback handler (tiktok-oauth-callback.js) can later confirm this
// exact request initiated the flow and recover which creator it belongs
// to -- TikTok's redirect back carries no Authorization header either.
const { adminClient, getAuthedCreator } = require('../supabase-admin');
const { buildAuthorizeUrl, generateState } = require('../tiktok');

module.exports = async function handleTiktokOauthStart(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const creator = await getAuthedCreator(req);
    if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

    const redirectUri = process.env.TIKTOK_REDIRECT_URI;
    if (!redirectUri) {
      return res.status(500).json({ error: 'TIKTOK_REDIRECT_URI is not configured' });
    }

    const state = generateState();
    const admin = adminClient();
    const { error } = await admin.from('oauth_states').insert({
      creator_id: creator.id,
      platform: 'tiktok',
      state,
    });
    if (error) return res.status(500).json({ error: error.message });

    const authorizeUrl = buildAuthorizeUrl({ state, redirectUri });
    return res.status(200).json({ authorizeUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to start TikTok connection' });
  }
};
