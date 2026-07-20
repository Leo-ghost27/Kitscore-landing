// GET /api/cron?job=tiktok-resync
//
// Same reasoning as cron-youtube-resync.js: closes the "scores only
// update on reconnect" staleness gap, this time for TikTok. Always
// refreshes the access token proactively via the stored refresh_token
// rather than trying the old one first -- that refresh call is itself
// the "is this connection still alive" check. A clean refresh failure
// means the creator revoked access; a failure on the subsequent
// user-info fetch is treated as transient and just logged, not grounds
// to disconnect a real connection over a flaky response.
//
// Runs daily (Vercel Hobby cron cap, see api/cron.js). Updates
// follower/video/like counts, which fires
// fn_recalc_engagement_quality_tiktok automatically via its
// platform_connections trigger -- no app-code score write needed here,
// unlike YouTube's content_consistency_youtube (which isn't a DB
// trigger). Confirmed no content_consistency_tiktok exists anywhere in
// the codebase before writing this, so there's no second component to
// recompute for TikTok the way there is for YouTube.

const { adminClient } = require('../supabase-admin');
const { refreshAccessToken, fetchTiktokUserInfo } = require('../tiktok');

module.exports = async function handleCronTiktokResync(req, res) {
  const admin = adminClient();
  const results = { checked: 0, refreshed: 0, revoked: 0, errors: 0 };

  try {
    const { data: connections, error } = await admin
      .from('platform_connections')
      .select('creator_id, refresh_token')
      .eq('platform', 'tiktok')
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
          await admin.rpc('fn_admin_disconnect_platform', {
            p_creator_id: conn.creator_id,
            p_platform: 'tiktok',
          });
          results.revoked++;
          continue;
        }
        results.refreshed++;

        const accessToken = tokenData.access_token;
        const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
        const userInfo = await fetchTiktokUserInfo(accessToken);

        await admin.from('platform_connections').update({
          access_token: accessToken,
          refresh_token: tokenData.refresh_token || conn.refresh_token,
          token_expires_at: expiresAt,
          follower_count: userInfo.follower_count ?? null,
          video_count: userInfo.video_count ?? null,
          like_count: userInfo.likes_count ?? null,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('creator_id', conn.creator_id).eq('platform', 'tiktok');
      } catch (perConnErr) {
        results.errors++;
        console.error('[cron-tiktok-resync] error for creator', conn.creator_id, perConnErr.message);
      }
    }

    return res.status(200).json(results);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'TikTok re-sync sweep failed' });
  }
};
