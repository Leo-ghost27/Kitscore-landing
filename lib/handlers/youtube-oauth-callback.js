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
const { scanBrandSafety } = require('../brand-safety-scan');
const { checkPaidDisclosure } = require('../disclosure-check');
const { sendEmail, brandSafetyFlagEmail, disclosureFlagEmail } = require('../email');

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
                has_paid_promotion: v.hasPaidPromotion ?? null,
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
              weight: 0.15,
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
          // double-weights this one dimension (0.30 instead of 0.15).
          // Mirrors the same cleanup already live in
          // fn_recalc_engagement_quality_youtube.
          //
          // content_consistency_instagram and content_consistency_twitch
          // were added after this file was first written -- this can no
          // longer assume it's the only OAuth source for this dimension,
          // so it rebalances the family the same way engagement_quality
          // already does for its own multi-platform case.
          await admin.from('score_components').delete()
            .eq('creator_id', stateRow.creator_id)
            .eq('component_key', 'content_consistency');
          await admin.rpc('fn_rebalance_component_family', {
            p_creator_id: stateRow.creator_id,
            p_prefix: 'content_consistency',
            p_total_weight: 0.15,
          });
        }

        // Brand safety text scan -- supplements (never replaces) the
        // self-report questionnaire. Clean scans just log to the audit
        // trail; flagged scans hold in pending_review and never touch
        // score_components directly -- see fn_admin_apply_brand_safety_scan,
        // which only an admin can invoke. Non-blocking, same as above.
        if (videos.length > 0) {
          const scan = await scanBrandSafety(videos);
          if (scan) {
            const { data: scanRow } = await admin.from('brand_safety_scans').insert({
              creator_id: stateRow.creator_id,
              platform: 'youtube',
              flagged: scan.flagged,
              categories: scan.categories,
              flagged_titles: scan.flaggedTitles,
              rationale: scan.rationale,
              model: scan.model,
              video_count_scanned: scan.videoCountScanned,
              status: scan.flagged ? 'pending_review' : 'clean',
            }).select('id').single();

            if (scan.flagged && scanRow) {
              const { data: creatorProfile } = await admin.from('profiles')
                .select('display_name').eq('id', stateRow.creator_id).single();
              try {
                await sendEmail({
                  to: 'hello@kitscore.co',
                  ...brandSafetyFlagEmail({
                    creatorName: creatorProfile?.display_name || 'A creator',
                    categories: scan.categories,
                    rationale: scan.rationale,
                    reviewUrl: `${DASHBOARD_URL.replace('dashboard.html', 'admin-brand-safety.html')}?scan=${scanRow.id}`,
                  }),
                });
              } catch (emailErr) {
                // Swallow -- the scan is already recorded and will show up
                // in the review board regardless of whether the email
                // notification succeeds.
              }
            }
          }
        }

        // Paid-disclosure check -- Phase 1 of real FTC/ad-disclosure
        // checking (see 2026-08-01-disclosure-scan.sql and
        // 2026-08-01b-creator-videos-paid-promotion-flag.sql for the full
        // design note). Deterministic, not LLM-based: compares YouTube's
        // own paidProductPlacementDetails flag (what the creator declared
        // at upload time) against a keyword check for a visible disclosure
        // marker -- no ANTHROPIC_API_KEY dependency. Same non-blocking,
        // flag-only pattern as the brand safety scan above -- only writes
        // to disclosure_scans, never score_components, contracts, or
        // escrow. YouTube-only: Instagram/TikTok's disclosure toggles
        // don't have a confirmed readable API field for already-posted
        // content, and neither platform's OAuth lib fetches caption/post
        // text yet regardless -- not built here, not guessed at.
        if (videos.length > 0) {
          const dscan = checkPaidDisclosure(videos);
          if (dscan) {
            const { data: dscanRow } = await admin.from('disclosure_scans').insert({
              creator_id: stateRow.creator_id,
              platform: 'youtube',
              flagged: dscan.flagged,
              suspected_titles: dscan.suspectedTitles,
              rationale: dscan.rationale,
              model: dscan.model,
              video_count_scanned: dscan.videoCountScanned,
              status: dscan.flagged ? 'pending_review' : 'clean',
            }).select('id').single();

            if (dscan.flagged && dscanRow) {
              const { data: creatorProfile } = await admin.from('profiles')
                .select('display_name').eq('id', stateRow.creator_id).single();
              try {
                await sendEmail({
                  to: 'hello@kitscore.co',
                  ...disclosureFlagEmail({
                    creatorName: creatorProfile?.display_name || 'A creator',
                    rationale: dscan.rationale,
                    reviewUrl: `${DASHBOARD_URL.replace('dashboard.html', 'admin-disclosure-review.html')}?scan=${dscanRow.id}`,
                  }),
                });
              } catch (emailErr) {
                // Swallow -- same reasoning as the brand safety email above.
              }
            }
          }
        }
      }
    } catch (secondaryErr) {
      // Logged, not swallowed -- this used to fail silently, which is how
      // brand_safety_scan (2026-07-13) went dark from launch with zero
      // rows ever written and nobody noticed. The OAuth connection itself
      // already succeeded and its response was already sent, so this can
      // only ever be a log line, not a user-facing error.
      console.error('[youtube-oauth-callback] secondary scan step failed:', secondaryErr?.message || secondaryErr);
    }

    return res.redirect(302, `${DASHBOARD_URL}?youtube_connected=1`);
  } catch (err) {
    return res.redirect(302, `${DASHBOARD_URL}?youtube_error=${encodeURIComponent(err.message || 'unknown')}`);
  }
};
