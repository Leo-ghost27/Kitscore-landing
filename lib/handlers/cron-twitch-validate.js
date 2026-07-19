// GET /api/cron-twitch-validate
//
// Twitch requires third-party apps to call /validate on startup and
// hourly thereafter for any session using a stored token, ending the
// session if it comes back invalid (revoked by the user, expired, etc):
// https://dev.twitch.tv/docs/authentication/validate-tokens
//
// This runs daily, not hourly -- Vercel's Hobby plan caps cron
// frequency, and the function-count comment in api/oauth.js confirms
// that's the plan this project is on. Daily is the honest maximum
// available without a plan upgrade, not a substitute for actually
// hourly. Worth knowing if Twitch's compliance expectations ever get
// checked directly.
//
// Bonus, since we're already fetching each connection anyway: refreshes
// follower_count/subscriber_count at the same time, which starts
// chipping away at the broader "scores only update on reconnect"
// staleness gap -- at least for Twitch, at least once a day.
//
// Security: same CRON_SECRET pattern as cron-evidence-nudges.js.

const { adminClient } = require('../supabase-admin');
const { refreshAccessToken, fetchTwitchOwnUser, fetchTwitchFollowerCount, fetchTwitchSubscriberCount } = require('../twitch');

const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';

async function isTokenValid(accessToken) {
  const res = await fetch(TWITCH_VALIDATE_URL, {
    // Twitch's /validate endpoint specifically uses the "OAuth" auth
    // scheme, not "Bearer" like every other Twitch API call -- easy to
    // get wrong, confirmed against their docs before writing this.
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  return res.ok;
}

module.exports = async function handleCronTwitchValidate(req, res) {
  const admin = adminClient();
  const results = { checked: 0, refreshed: 0, revoked: 0, errors: 0 };

  try {
    const { data: connections, error } = await admin
      .from('platform_connections')
      .select('creator_id, access_token, refresh_token')
      .eq('platform', 'twitch');

    if (error) return res.status(500).json({ error: error.message });

    for (const conn of connections || []) {
      results.checked++;
      try {
        let accessToken = conn.access_token;
        let valid = await isTokenValid(accessToken);

        if (!valid && conn.refresh_token) {
          // Token expired or otherwise invalid -- try a refresh before
          // concluding it was actually revoked.
          try {
            const refreshed = await refreshAccessToken(conn.refresh_token);
            accessToken = refreshed.access_token;
            valid = true;
            results.refreshed++;

            await admin.from('platform_connections').update({
              access_token: refreshed.access_token,
              refresh_token: refreshed.refresh_token || conn.refresh_token,
              token_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
            }).eq('creator_id', conn.creator_id).eq('platform', 'twitch');
          } catch (refreshErr) {
            valid = false;
          }
        }

        if (!valid) {
          // Refresh failed too -- the user genuinely revoked access (or
          // the token is otherwise dead). Same cleanup a manual
          // disconnect would do, just triggered by us instead of them.
          await admin.rpc('fn_admin_disconnect_platform', {
            p_creator_id: conn.creator_id,
            p_platform: 'twitch',
          });
          results.revoked++;
          continue;
        }

        // Still valid -- refresh the stats while we're here.
        const user = await fetchTwitchOwnUser(accessToken);
        const followerCount = await fetchTwitchFollowerCount(accessToken, user.id);
        const subscriberCount = await fetchTwitchSubscriberCount(accessToken, user.id);

        await admin.from('platform_connections').update({
          follower_count: followerCount,
          subscriber_count: subscriberCount,
          last_synced_at: new Date().toISOString(),
        }).eq('creator_id', conn.creator_id).eq('platform', 'twitch');
      } catch (perConnErr) {
        results.errors++;
        console.error('[cron-twitch-validate] error for creator', conn.creator_id, perConnErr.message);
      }
    }

    return res.status(200).json(results);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Twitch validation sweep failed' });
  }
};
