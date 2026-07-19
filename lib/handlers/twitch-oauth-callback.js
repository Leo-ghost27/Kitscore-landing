// Handler for GET /api/twitch-oauth?action=callback
// Same pattern as tiktok-oauth-callback.js: state param (written by
// twitch-oauth-start.js) ties this back to a specific creator since
// there's no Authorization header available on a redirect. State row is
// deleted-on-read so it can never be replayed.
const { adminClient } = require('../supabase-admin');
const { exchangeCodeForToken, fetchTwitchOwnUser, fetchTwitchFollowerCount, fetchTwitchSubscriberCount } = require('../twitch');

const DASHBOARD_URL = '/app/dashboard.html';

module.exports = async function handleTwitchOauthCallback(req, res) {
  const { code, state, error: twitchError } = req.query || {};

  if (twitchError) {
    return res.redirect(302, `${DASHBOARD_URL}?twitch_error=${encodeURIComponent(twitchError)}`);
  }
  if (!code || !state) {
    return res.redirect(302, `${DASHBOARD_URL}?twitch_error=missing_params`);
  }

  try {
    const admin = adminClient();

    const { data: stateRow, error: stateErr } = await admin
      .from('oauth_states')
      .delete()
      .eq('state', state)
      .eq('platform', 'twitch')
      .select()
      .maybeSingle();

    if (stateErr || !stateRow) {
      return res.redirect(302, `${DASHBOARD_URL}?twitch_error=invalid_state`);
    }

    const redirectUri = process.env.TWITCH_REDIRECT_URI;
    const tokenData = await exchangeCodeForToken({ code, redirectUri });
    const user = await fetchTwitchOwnUser(tokenData.access_token);
    const followerCount = await fetchTwitchFollowerCount(tokenData.access_token, user.id);
    const subscriberCount = await fetchTwitchSubscriberCount(tokenData.access_token, user.id);

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const { error: upsertErr } = await admin.from('platform_connections').upsert(
      {
        creator_id: stateRow.creator_id,
        platform: 'twitch',
        platform_user_id: user.id,
        platform_handle: user.display_name || user.login || null,
        verification_method: 'oauth',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: expiresAt,
        scopes: tokenData.scope ? tokenData.scope.join(',') : null,
        follower_count: followerCount,
        subscriber_count: subscriberCount,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'creator_id,platform' }
    );

    if (upsertErr) {
      const msg = upsertErr.message && upsertErr.message.includes('PLATFORM_CAP')
        ? 'platform_cap'
        : 'save_failed';
      return res.redirect(302, `${DASHBOARD_URL}?twitch_error=${msg}`);
    }

    return res.redirect(302, `${DASHBOARD_URL}?twitch_connected=1`);
  } catch (err) {
    return res.redirect(302, `${DASHBOARD_URL}?twitch_error=${encodeURIComponent(err.message || 'unknown')}`);
  }
};
