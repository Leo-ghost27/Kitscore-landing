// Handler for GET /api/tiktok-oauth?action=callback
// TikTok redirects the browser here after the creator approves (or
// denies) access. No Authorization header available at this point -- the
// `state` param (written by tiktok-oauth-start.js into oauth_states) is
// what ties this callback back to a specific creator and rules out a
// forged or replayed callback. Each state row is deleted-on-read so it
// can never be reused, even under a concurrent double-submit.
const { adminClient } = require('../supabase-admin');
const { exchangeCodeForToken, fetchTiktokUserInfo } = require('../tiktok');

// Where to send the creator back to, success or failure. dashboard.html
// reads these query params to show a toast -- see the connectTiktok()
// wiring there.
const DASHBOARD_URL = '/app/dashboard.html';

module.exports = async function handleTiktokOauthCallback(req, res) {
  const { code, state, error: tiktokError } = req.query || {};

  if (tiktokError) {
    return res.redirect(302, `${DASHBOARD_URL}?tiktok_error=${encodeURIComponent(tiktokError)}`);
  }
  if (!code || !state) {
    return res.redirect(302, `${DASHBOARD_URL}?tiktok_error=missing_params`);
  }

  try {
    const admin = adminClient();

    // Delete-and-check in one step so this state value can never be
    // consumed twice, even under concurrent requests.
    const { data: stateRow, error: stateErr } = await admin
      .from('oauth_states')
      .delete()
      .eq('state', state)
      .eq('platform', 'tiktok')
      .select()
      .maybeSingle();

    if (stateErr || !stateRow) {
      return res.redirect(302, `${DASHBOARD_URL}?tiktok_error=invalid_state`);
    }

    const redirectUri = process.env.TIKTOK_REDIRECT_URI;
    const tokenData = await exchangeCodeForToken({ code, redirectUri });
    const userInfo = await fetchTiktokUserInfo(tokenData.access_token);

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const { error: upsertErr } = await admin.from('platform_connections').upsert(
      {
        creator_id: stateRow.creator_id,
        platform: 'tiktok',
        platform_user_id: userInfo.open_id,
        platform_handle: userInfo.display_name || null,
        verification_method: 'oauth',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: expiresAt,
        scopes: tokenData.scope || null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'creator_id,platform' }
    );

    if (upsertErr) {
      const msg = upsertErr.message && upsertErr.message.includes('PLATFORM_CAP')
        ? 'platform_cap'
        : 'save_failed';
      return res.redirect(302, `${DASHBOARD_URL}?tiktok_error=${msg}`);
    }

    return res.redirect(302, `${DASHBOARD_URL}?tiktok_connected=1`);
  } catch (err) {
    return res.redirect(302, `${DASHBOARD_URL}?tiktok_error=${encodeURIComponent(err.message || 'unknown')}`);
  }
};
