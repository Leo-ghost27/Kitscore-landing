// POST /api/connect-platform  { platform: 'youtube', handle }
// Authenticated creator only. Looks up public platform stats (currently
// just YouTube, via API key -- no OAuth) and upserts a platform_connections
// row so directory.html / evaluate.html can eventually surface a live
// subscriber count instead of (or alongside) the self-reported
// evidence.platform text field.
//
// Renamed from the old platform-specific /api/connect-youtube during the
// July 2026 API-route consolidation, and generalized so the next public-
// data platform (if any) is a new entry in PLATFORM_LOOKUPS below instead
// of a whole new route/function slot.
//
// This is deliberately public-data-only and does NOT prove the creator
// owns the account -- see verification_method in
// supabase/2026-07-09-platform-connections.sql. Anywhere this connection
// is shown to a sponsor it must be labelled "linked", not "verified".
// Ownership-verified connections (OAuth) -- planned for YouTube and TikTok
// -- are a separate, later pass with their own dedicated route(s); see
// docs/session-handoff for current status.
const { adminClient, getAuthedCreator } = require('../lib/supabase-admin');
const { fetchYoutubeChannelStats } = require('../lib/youtube');

// Each entry takes a handle/id string and returns the shape upserted below
// (channelId/handle/subscriberCount/videoCount/viewCount), or null/throws
// if the lookup fails. Add new platforms here as their public-data lookups
// become available.
const PLATFORM_LOOKUPS = {
  youtube: fetchYoutubeChannelStats,
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const creator = await getAuthedCreator(req);
    if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

    // platform defaults to 'youtube' for back-compat with the original
    // YouTube-only route/frontend calls that don't send it explicitly.
    const { platform = 'youtube', handle } = req.body || {};
    if (!handle || !handle.trim()) {
      return res.status(400).json({ error: 'handle is required' });
    }

    const lookup = PLATFORM_LOOKUPS[platform];
    if (!lookup) {
      return res.status(400).json({ error: `Public-data linking isn't available yet for ${platform}.` });
    }

    const stats = await lookup(handle);
    if (!stats) {
      return res.status(404).json({ error: `No ${platform} account found for that handle` });
    }

    const admin = adminClient();
    const { data, error } = await admin
      .from('platform_connections')
      .upsert(
        {
          creator_id: creator.id,
          platform,
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
    return res.status(500).json({ error: err.message || 'Failed to connect platform account' });
  }
};
