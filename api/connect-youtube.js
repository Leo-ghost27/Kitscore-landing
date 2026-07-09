// POST /api/connect-youtube  { handle }
// Authenticated creator only. Looks up their YouTube channel by @handle
// via the public Data API (API key, no OAuth -- these are public numbers
// anyone can see on the channel page), then upserts a platform_connections
// row so directory.html / evaluate.html can eventually surface a live
// subscriber count instead of (or alongside) the self-reported
// evidence.platform text field.
//
// This is deliberately public-data-only and does NOT prove the creator
// owns the channel -- see verification_method in
// supabase/2026-07-09-platform-connections.sql. Anywhere this connection
// is shown to a sponsor it must be labelled "linked", not "verified".
// Ownership-verified YouTube (OAuth) is a later pass, same shape as the
// TikTok flow in api/tiktok-oauth-start.js.
const { adminClient, getAuthedCreator } = require('./_supabase-admin');
const { fetchYoutubeChannelStats } = require('../lib/youtube');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const creator = await getAuthedCreator(req);
    if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

    const { handle } = req.body || {};
    if (!handle || !handle.trim()) {
      return res.status(400).json({ error: 'handle is required' });
    }

    const stats = await fetchYoutubeChannelStats(handle);
    if (!stats) {
      return res.status(404).json({ error: 'No YouTube channel found for that handle' });
    }

    const admin = adminClient();
    const { data, error } = await admin
      .from('platform_connections')
      .upsert(
        {
          creator_id: creator.id,
          platform: 'youtube',
          platform_user_id: stats.channelId,
          platform_handle: stats.handle || handle.trim(),
          verification_method: 'public_lookup',
          follower_count: stats.subscriberCount,
          video_count: stats.videoCount,
          view_count: stats.viewCount,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'creator_id,platform' }
      )
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ connection: data });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to connect YouTube channel' });
  }
};
