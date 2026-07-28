// Handler for GET /api/discord-oauth?action=callback
// Same pattern as twitch-oauth-callback.js: state param (written by
// discord-oauth-start.js) ties this back to a specific creator since
// there's no Authorization header available on a redirect. State row is
// deleted-on-read so it can never be replayed.
const { adminClient } = require('../supabase-admin');
const { exchangeCodeForToken, fetchDiscordOwnUser, fetchDiscordOwnedGuild } = require('../discord');

const DASHBOARD_URL = '/app/dashboard.html';

module.exports = async function handleDiscordOauthCallback(req, res) {
  const { code, state, error: discordError } = req.query || {};

  if (discordError) {
    return res.redirect(302, `${DASHBOARD_URL}?discord_error=${encodeURIComponent(discordError)}`);
  }
  if (!code || !state) {
    return res.redirect(302, `${DASHBOARD_URL}?discord_error=missing_params`);
  }

  try {
    const admin = adminClient();

    const { data: stateRow, error: stateErr } = await admin
      .from('oauth_states')
      .delete()
      .eq('state', state)
      .eq('platform', 'discord')
      .select()
      .maybeSingle();

    if (stateErr || !stateRow) {
      return res.redirect(302, `${DASHBOARD_URL}?discord_error=invalid_state`);
    }

    const redirectUri = process.env.DISCORD_REDIRECT_URI;
    const tokenData = await exchangeCodeForToken({ code, redirectUri });
    const user = await fetchDiscordOwnUser(tokenData.access_token);
    const ownedGuild = await fetchDiscordOwnedGuild(tokenData.access_token);

    if (!ownedGuild) {
      // Mirrors the "this creator doesn't have the thing we need a
      // signal from yet" branches elsewhere (e.g. Twitch subscriber
      // count for non-Partner channels) -- not a hard error, just
      // nothing to attach a score to.
      return res.redirect(302, `${DASHBOARD_URL}?discord_error=no_owned_server`);
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    const { error: upsertErr } = await admin.from('platform_connections').upsert(
      {
        creator_id: stateRow.creator_id,
        platform: 'discord',
        platform_user_id: user.id,
        platform_handle: user.global_name || user.username || null,
        verification_method: 'oauth',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: expiresAt,
        scopes: tokenData.scope || null,
        follower_count: ownedGuild.approximate_member_count ?? null,
        // approximate_presence_count (online members) is the closest
        // Discord analog to an engagement signal -- stored the same way
        // Twitch's subscriber_count rides alongside follower_count.
        subscriber_count: ownedGuild.approximate_presence_count ?? null,
        // Never previously stored -- needed so the message-polling bot
        // (added later, see 2026-07-28-discord-message-engagement.sql)
        // knows which actual server to check. Was available on
        // ownedGuild.id the whole time, just never persisted.
        guild_id: ownedGuild.id,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'creator_id,platform' }
    );

    if (upsertErr) {
      const msg = upsertErr.message && upsertErr.message.includes('PLATFORM_CAP')
        ? 'platform_cap'
        : 'save_failed';
      return res.redirect(302, `${DASHBOARD_URL}?discord_error=${msg}`);
    }

    return res.redirect(302, `${DASHBOARD_URL}?discord_connected=1`);
  } catch (err) {
    return res.redirect(302, `${DASHBOARD_URL}?discord_error=${encodeURIComponent(err.message || 'unknown')}`);
  }
};
