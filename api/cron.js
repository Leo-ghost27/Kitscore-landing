// GET /api/cron?job=evidence-nudges | ?job=twitch-validate | ?job=youtube-resync | ?job=tiktok-resync | ?job=discord-poll | ?job=health-check | ?job=escrow-stuck-nudge | ?job=repitch-nudges
//
// health-check (added 2026-07-31) closes the "found by accident" gap:
// aggregates client_failures, notification_failures, and stale (never-
// completed) oauth_states, emailing a digest only when something crosses
// a real threshold. See lib/handlers/cron-health-check.js for detail.
//
// Merges what were two standalone cron functions (api/cron-evidence-
// nudges.js, api/cron-twitch-validate.js) into one, same reasoning and
// same query-param dispatch pattern as api/oauth.js. Unlike OAuth
// callback URLs, cron paths aren't registered anywhere external -- only
// Vercel's own scheduler calls them, so there was no need for the
// rewrite-based URL preservation trick oauth.js uses; the schedule in
// vercel.json just points straight at /api/cron?job=... directly.
//
// youtube-resync and tiktok-resync added the same way -- closes the
// "scores only update on reconnect" staleness gap for the two other
// OAuth platforms, matching the daily stat-refresh Twitch's validate
// job already does as a side effect. Still one function (this
// dispatcher), many jobs -- these didn't cost a Vercel Hobby function
// slot, which matters given the project is at 11/12 as of the
// "Verified by Kitscore" badge feature.
//
// repitch-nudges added 2026-08-15 -- same reasoning, still no free
// function slot. One-time-per-campaign nudge, weekly sweep is plenty
// (evidence-nudges' existing Monday 9am slot pattern). See
// lib/handlers/cron-repitch-nudges.js.
//
// Security: Vercel automatically sends `Authorization: Bearer
// ${CRON_SECRET}` on cron-triggered requests when CRON_SECRET is set in
// the project's env vars. Checked once here for all jobs, rather than
// duplicated per-handler like before.
//
// Also accepts a valid admin Supabase session as an alternative to
// CRON_SECRET -- added so an admin can manually re-run a job from a UI
// button (e.g. "check now" on the Discord poll, since it's new and its
// first real run needs verifying) without ever having CRON_SECRET
// itself exposed to a browser. The button sends the admin's own logged-
// in session token, same Authorization: Bearer pattern every other
// authenticated fetch() in this app already uses -- getAuthedProfile
// verifies it server-side and checks role === 'admin' before allowing
// anything through, so this can't be used by a non-admin caller.
const { getAuthedProfile } = require('../lib/supabase-admin');
const handleEvidenceNudges = require('../lib/handlers/cron-evidence-nudges');
const handleTwitchValidate = require('../lib/handlers/cron-twitch-validate');
const handleYoutubeResync = require('../lib/handlers/cron-youtube-resync');
const handleTiktokResync = require('../lib/handlers/cron-tiktok-resync');
const handleDiscordPoll = require('../lib/handlers/cron-discord-poll');
const handleHealthCheck = require('../lib/handlers/cron-health-check');
const handleEscrowStuckNudge = require('../lib/handlers/cron-escrow-stuck-nudge');
const handleRepitchNudges = require('../lib/handlers/cron-repitch-nudges');

module.exports = async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const isCronSecret = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isCronSecret) {
    const admin = await getAuthedProfile(req, 'admin');
    if (!admin) return res.status(401).json({ error: 'Unauthorized' });
  }

  const job = req.query?.job;

  if (job === 'evidence-nudges') return handleEvidenceNudges(req, res);
  if (job === 'twitch-validate') return handleTwitchValidate(req, res);
  if (job === 'youtube-resync') return handleYoutubeResync(req, res);
  if (job === 'tiktok-resync') return handleTiktokResync(req, res);
  if (job === 'discord-poll') return handleDiscordPoll(req, res);
  if (job === 'health-check') return handleHealthCheck(req, res);
  if (job === 'escrow-stuck-nudge') return handleEscrowStuckNudge(req, res);
  if (job === 'repitch-nudges') return handleRepitchNudges(req, res);

  return res.status(400).json({ error: 'Unknown or missing job. Use ?job=evidence-nudges, ?job=twitch-validate, ?job=youtube-resync, ?job=tiktok-resync, ?job=discord-poll, ?job=health-check, ?job=escrow-stuck-nudge, or ?job=repitch-nudges.' });
};
