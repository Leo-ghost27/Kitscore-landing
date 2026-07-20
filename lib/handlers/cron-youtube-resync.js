// GET /api/cron?job=youtube-resync
//
// Closes the "scores only update on reconnect" staleness gap for
// YouTube, same reasoning as cron-twitch-validate.js's bonus stat
// refresh but built for YouTube specifically rather than copied
// wholesale -- YouTube has no Twitch-style mandatory /validate
// endpoint, so there's no reason to try the old (likely already
// expired -- Google access tokens last ~1hr) access_token first. This
// always refreshes proactively via the stored refresh_token, and
// that refresh call itself IS the "is this connection still alive"
// check: a clean failure there (invalid_grant, i.e. the creator
// revoked access in their Google account) is an unambiguous signal to
// disconnect. A failure on the *subsequent* data fetch is treated as
// transient (rate limit, momentary API blip) and just logged/skipped
// -- not grounds to disconnect a creator's real connection over a
// flaky response.
//
// Runs daily (Vercel Hobby cron cap, see api/cron.js). Updates
// follower/video/view counts, which fires fn_recalc_engagement_quality_
// youtube automatically via its platform_connections trigger, and
// separately recomputes content_consistency_youtube here in app code
// (that one isn't a DB trigger -- see youtube-oauth-callback.js, which
// this mirrors for the scoring half).
//
// Deliberately NOT re-running the brand-safety LLM scan here. That's a
// real, per-call cost (Claude Sonnet) and would re-flag the same or
// highly similar videos daily, generating repeat admin review-queue
// noise for content that's already been scanned once. Brand safety
// re-scans stay tied to an actual reconnect, not this daily sweep.

const { adminClient } = require('../supabase-admin');
const {
  refreshAccessToken,
  fetchOwnYoutubeChannel,
  fetchYoutubeUploads,
  computeContentConsistency,
} = require('../google-oauth');

module.exports = async function handleCronYoutubeResync(req, res) {
  const admin = adminClient();
  const results = { checked: 0, refreshed: 0, revoked: 0, errors: 0 };

  try {
    const { data: connections, error } = await admin
      .from('platform_connections')
      .select('creator_id, refresh_token')
      .eq('platform', 'youtube')
      .eq('verification_method', 'oauth')
      .not('refresh_token', 'is', null);

    if (error) return res.status(500).json({ error: error.message });

    for (const conn of connections || []) {
      results.checked++;
      try {
        let tokenData;
        try {
          tokenData = await refreshAccessToken(conn.refresh_token);
        } catch (refreshErr) {
          // Refresh itself failed -- the creator revoked access (or the
          // refresh token is otherwise dead). Same cleanup a manual
          // disconnect would do, just triggered by us instead of them.
          await admin.rpc('fn_admin_disconnect_platform', {
            p_creator_id: conn.creator_id,
            p_platform: 'youtube',
          });
          results.revoked++;
          continue;
        }
        results.refreshed++;

        const accessToken = tokenData.access_token;
        const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
        const channel = await fetchOwnYoutubeChannel(accessToken);

        await admin.from('platform_connections').update({
          access_token: accessToken,
          // Google only reliably returns a refresh_token on first
          // consent -- don't null out the stored one on a refresh-only
          // grant, same rule the OAuth callback follows.
          refresh_token: tokenData.refresh_token || conn.refresh_token,
          token_expires_at: expiresAt,
          follower_count: channel.subscriberCount,
          video_count: channel.videoCount,
          view_count: channel.viewCount,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('creator_id', conn.creator_id).eq('platform', 'youtube');

        // Best-effort content_consistency_youtube recompute, mirroring
        // the OAuth callback -- non-fatal if it fails, the stat refresh
        // above already succeeded and is the main point of this job.
        try {
          if (channel.uploadsPlaylistId) {
            const videos = await fetchYoutubeUploads(accessToken, channel.uploadsPlaylistId);
            const consistencyValue = computeContentConsistency(videos);
            if (consistencyValue !== null) {
              await admin.from('score_components').upsert(
                {
                  creator_id: conn.creator_id,
                  component_key: 'content_consistency_youtube',
                  label: 'Content consistency (YouTube)',
                  weight: 0.20,
                  value: consistencyValue,
                  status: 'live_verified',
                  updated_at: new Date().toISOString(),
                },
                { onConflict: 'creator_id,component_key' }
              );
              // Same stale-key cleanup as the OAuth callback -- see
              // youtube-oauth-callback.js for the full reasoning.
              await admin.from('score_components').delete()
                .eq('creator_id', conn.creator_id)
                .eq('component_key', 'content_consistency');
            }
          }
        } catch (consistencyErr) {
          // Swallow -- stat refresh above already succeeded.
        }
      } catch (perConnErr) {
        results.errors++;
        console.error('[cron-youtube-resync] error for creator', conn.creator_id, perConnErr.message);
      }
    }

    return res.status(200).json(results);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'YouTube re-sync sweep failed' });
  }
};
