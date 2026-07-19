// Handler for POST /api/twitch-oauth?action=start
// Same pattern as tiktok-oauth-start.js: authenticated creator only,
// returns an authorize URL for the frontend to navigate to rather than
// redirecting server-side, since this needs to be reached with a Bearer
// token that a plain top-level navigation can't carry.
const { adminClient, getAuthedCreator } = require('../supabase-admin');
const { buildAuthorizeUrl, generateState } = require('../twitch');

module.exports = async function handleTwitchOauthStart(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const creator = await getAuthedCreator(req);
    if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

    const redirectUri = process.env.TWITCH_REDIRECT_URI;
    if (!redirectUri) {
      return res.status(500).json({ error: 'TWITCH_REDIRECT_URI is not configured' });
    }

    const state = generateState();
    const admin = adminClient();
    const { error } = await admin.from('oauth_states').insert({
      creator_id: creator.id,
      platform: 'twitch',
      state,
    });
    if (error) return res.status(500).json({ error: error.message });

    const authorizeUrl = buildAuthorizeUrl({ state, redirectUri });
    return res.status(200).json({ authorizeUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to start Twitch connection' });
  }
};
