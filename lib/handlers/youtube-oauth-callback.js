// Handler for GET /api/youtube-oauth-callback (Google redirects here after
// the creator approves or denies access -- code/state/error appended by
// Google itself). No Authorization header available at this point -- the
// `state` param (written by youtube-oauth-start.js into oauth_states) is
// what ties this callback back to a specific creator and rules out a
// forged or replayed callback. Each state row is deleted-on-read so it
// can never be reused, even under a concurrent double-submit. Same shape
// as lib/handlers/tiktok-oauth-callback.js.
//
// Upserts onto the SAME platform_connections row a public_lookup YouTube
// connection may already occupy (unique on creator_id, platform) --
// completing this flow upgrades that row to verification_method: 'oauth',
// which is the intended transition per supabase/2026-07-09-platform-
// connections.sql, not a bug.
const { adminClient } = require('../supabase-admin');
const { exchangeCodeForToken, fetchOwnYoutubeChannel } = require('../google-oauth');

// dashboard.html reads these query params to show a toast -- see the
// connectYoutubeOauth() wiring there.
const DASHBOARD_URL = '/app/dashboard.html';

module.exports = async function handleYoutubeOauthCallback(req, res) {
  const { code, state, error: googleError } = req.query || {};

  if (googleError) {
    return res.redirect(302, `${DASHBOARD_URL}?youtube_error=${encodeURIComponent(googleError)}`);
  }
  if (!code || !state) {
    return res.redirect(302, `${DASHBOARD_URL}?youtube_error=missing_params`);
  }

  try {
    const admin = adminClient();

    // Delete-and-check in one step so this state value can never be
    // consumed twice, even under concurrent requests.
    const { data: stateRow, error: stateErr } = await admin
      .from('oauth_states')
      .delete()
      .eq('state', state)
      .eq('platform', 'youtube')
      .select()
      .maybeSingle();

    if (stateErr || !stateRow) {
      return res.redirect(302, `${DASHBOARD_URL}?youtube_error=invalid_state`);
    }

    const redirectUri = process.env.YOUTUBE_REDIRECT_URI;
    const tokenData = await exchangeCodeForToken({ code, redirectUri });
    const channel = await fetchOwnYoutubeChannel(tokenData.access_token);

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const { error: upsertErr } = await admin.from('platform_connections').upsert(
      {
        creator_id: stateRow.creator_id,
        platform: 'youtube',
        platform_user_id: channel.channelId,
        platform_handle: channel.handle || channel.title || null,
        verification_method: 'oauth',
        access_token: tokenData.access_token,
        // Google only reliably returns a refresh_token on first consent;
        // don't null out a previously-stored one on a refresh-only grant.
        refresh_token: tokenData.refresh_token || undefined,
        token_expires_at: expiresAt,
        scopes: tokenData.scope || null,
        follower_count: channel.subscriberCount,
        video_count: channel.videoCount,
        view_count: channel.viewCount,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'creator_id,platform' }
    );

    if (upsertErr) {
      const msg = upsertErr.message && upsertErr.message.includes('PLATFORM_CAP')
        ? 'platform_cap'
        : 'save_failed';
      return res.redirect(302, `${DASHBOARD_URL}?youtube_error=${msg}`);
    }

    return res.redirect(302, `${DASHBOARD_URL}?youtube_connected=1`);
  } catch (err) {
    return res.redirect(302, `${DASHBOARD_URL}?youtube_error=${encodeURIComponent(err.message || 'unknown')}`);
  }
};
