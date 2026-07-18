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
const { exchangeCodeForToken, fetchOwnYoutubeChannel, fetchYoutubeUploads, computeContentConsistency } = require('../google-oauth');

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

    // Best-effort: pull the creator's own upload history to compute
    // content_consistency_youtube (posting cadence) from real publish
    // dates instead of the old self-report/admin-review evidence flow.
    // Deliberately non-blocking -- if this API call or write fails for
    // any reason, the connection itself has already succeeded above and
    // shouldn't be rolled back or surfaced as an error over a secondary
    // scoring component. Also feeds creator_videos, which the upcoming
    // brand_safety text scan reads from separately.
    try {
      if (channel.uploadsPlaylistId) {
        const videos = await fetchYoutubeUploads(tokenData.access_token, channel.uploadsPlaylistId);

        if (videos.length > 0) {
          await admin.from('creator_videos').upsert(
            videos
              .filter(v => v.videoId)
              .map(v => ({
                creator_id: stateRow.creator_id,
                platform: 'youtube',
                video_id: v.videoId,
                title: v.title,
                description: v.description,
                published_at: v.publishedAt,
                fetched_at: new Date().toISOString(),
              })),
            { onConflict: 'creator_id,platform,video_id' }
          );
        }

        const consistencyValue = computeContentConsistency(videos);
        if (consistencyValue !== null) {
          await admin.from('score_components').upsert(
            {
              creator_id: stateRow.creator_id,
              component_key: 'content_consistency_youtube',
              label: 'Content consistency (YouTube)',
              weight: 0.20,
              value: consistencyValue,
              status: 'live_verified',
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'creator_id,component_key' }
          );
          // OAuth verification supersedes an earlier evidence-submitted
          // score for this same dimension. Without this, a creator who
          // uploaded evidence before connecting YouTube keeps both the
          // old 'content_consistency' row and the new
          // 'content_consistency_youtube' row -- fn_recalc_trust_score
          // sums value*weight with no dedup, so that silently
          // double-weights this one dimension (0.40 instead of 0.20).
          // Mirrors the same cleanup already live in
          // fn_recalc_engagement_quality_youtube. No multi-platform
          // rebalance needed here (unlike engagement_quality, which also
          // has a TikTok path) -- YouTube is currently the only OAuth
          // source for content consistency, confirmed by grepping for
          // 'content_consistency_tiktok' before writing this (no matches).
          await admin.from('score_components').delete()
            .eq('creator_id', stateRow.creator_id)
            .eq('component_key', 'content_consistency');
        }
      }
    } catch (secondaryErr) {
      // Swallow -- see comment above. The connection succeeded; this is
      // a nice-to-have that can be retried on the next reconnect.
    }

    return res.redirect(302, `${DASHBOARD_URL}?youtube_connected=1`);
  } catch (err) {
    return res.redirect(302, `${DASHBOARD_URL}?youtube_error=${encodeURIComponent(err.message || 'unknown')}`);
  }
};
