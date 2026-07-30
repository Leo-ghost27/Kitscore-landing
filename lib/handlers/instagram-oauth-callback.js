// Handler for GET /api/instagram-oauth?action=callback
// Same pattern as twitch-oauth-callback.js: state param (written by
// instagram-oauth-start.js) ties this back to a specific creator since
// there's no Authorization header available on a redirect. State row is
// deleted-on-read so it can never be replayed.
//
// One extra step vs. Twitch/TikTok/YouTube: Instagram's code exchange
// only returns a short-lived (~1hr) token, so this immediately trades
// it up for a long-lived (~60 day) token before storing anything --
// only the long-lived token is ever persisted.
const { adminClient } = require('../supabase-admin');
const { exchangeCodeForToken, exchangeForLongLivedToken, fetchInstagramOwnUser, fetchInstagramMedia, computeContentConsistency } = require('../instagram');

const DASHBOARD_URL = '/app/dashboard.html';

module.exports = async function handleInstagramOauthCallback(req, res) {
  const { code, state, error: igError } = req.query || {};

  if (igError) {
    return res.redirect(302, `${DASHBOARD_URL}?instagram_error=${encodeURIComponent(igError)}`);
  }
  if (!code || !state) {
    return res.redirect(302, `${DASHBOARD_URL}?instagram_error=missing_params`);
  }

  try {
    const admin = adminClient();

    const { data: stateRow, error: stateErr } = await admin
      .from('oauth_states')
      .delete()
      .eq('state', state)
      .eq('platform', 'instagram')
      .select()
      .maybeSingle();

    if (stateErr || !stateRow) {
      return res.redirect(302, `${DASHBOARD_URL}?instagram_error=invalid_state`);
    }

    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;
    const shortLived = await exchangeCodeForToken({ code, redirectUri });
    const longLived = await exchangeForLongLivedToken(shortLived.access_token);
    const user = await fetchInstagramOwnUser(longLived.access_token);

    const expiresAt = new Date(Date.now() + longLived.expires_in * 1000).toISOString();

    const { error: upsertErr } = await admin.from('platform_connections').upsert(
      {
        creator_id: stateRow.creator_id,
        platform: 'instagram',
        platform_user_id: user.id,
        platform_handle: user.username || null,
        verification_method: 'oauth',
        access_token: longLived.access_token,
        refresh_token: null, // Instagram has no refresh_token grant -- see refreshLongLivedToken() in lib/instagram.js instead.
        token_expires_at: expiresAt,
        scopes: 'instagram_business_basic',
        follower_count: typeof user.followers_count === 'number' ? user.followers_count : null,
        media_count: typeof user.media_count === 'number' ? user.media_count : null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'creator_id,platform' }
    );

    if (upsertErr) {
      const msg = upsertErr.message && upsertErr.message.includes('PLATFORM_CAP')
        ? 'platform_cap'
        : 'save_failed';
      return res.redirect(302, `${DASHBOARD_URL}?instagram_error=${msg}`);
    }

    // Best-effort, non-blocking -- same reasoning as YouTube's equivalent
    // block: if this fails, the platform connection itself already
    // succeeded and shouldn't be rolled back over a secondary component.
    //
    // Unlike YouTube's original build, this can now coexist with another
    // platform's content_consistency_<platform> row (e.g. a creator with
    // both YouTube and Instagram connected), so this calls
    // fn_rebalance_component_family to split the 0.20 total weight across
    // however many are live -- mirrors how engagement_quality already
    // handles multiple platforms. YouTube's own write path picked up the
    // same rebalance call in this change too (see
    // youtube-oauth-callback.js) since it could no longer assume it's the
    // only source.
    try {
      const media = await fetchInstagramMedia(longLived.access_token);
      const consistencyValue = computeContentConsistency(media);
      if (consistencyValue !== null) {
        await admin.from('score_components').upsert(
          {
            creator_id: stateRow.creator_id,
            component_key: 'content_consistency_instagram',
            label: 'Content consistency (Instagram)',
            weight: 0.20,
            value: consistencyValue,
            status: 'live_verified',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'creator_id,component_key' }
        );
        await admin.from('score_components').delete()
          .eq('creator_id', stateRow.creator_id)
          .eq('component_key', 'content_consistency');
        await admin.rpc('fn_rebalance_component_family', {
          p_creator_id: stateRow.creator_id,
          p_prefix: 'content_consistency',
          p_total_weight: 0.20,
        });
      }
    } catch (ccErr) {
      console.error('Instagram content_consistency computation failed (non-fatal):', ccErr.message);
    }

    return res.redirect(302, `${DASHBOARD_URL}?instagram_connected=1`);
  } catch (err) {
    return res.redirect(302, `${DASHBOARD_URL}?instagram_error=${encodeURIComponent(err.message || 'unknown')}`);
  }
};
