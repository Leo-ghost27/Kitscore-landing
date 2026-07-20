// GET /api/cron?job=evidence-nudges | ?job=twitch-validate | ?job=youtube-resync | ?job=tiktok-resync
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
// Security: Vercel automatically sends `Authorization: Bearer
// ${CRON_SECRET}` on cron-triggered requests when CRON_SECRET is set in
// the project's env vars. Checked once here for all jobs, rather than
// duplicated per-handler like before.
const handleEvidenceNudges = require('../lib/handlers/cron-evidence-nudges');
const handleTwitchValidate = require('../lib/handlers/cron-twitch-validate');
const handleYoutubeResync = require('../lib/handlers/cron-youtube-resync');
const handleTiktokResync = require('../lib/handlers/cron-tiktok-resync');

module.exports = async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const job = req.query?.job;

  if (job === 'evidence-nudges') return handleEvidenceNudges(req, res);
  if (job === 'twitch-validate') return handleTwitchValidate(req, res);
  if (job === 'youtube-resync') return handleYoutubeResync(req, res);
  if (job === 'tiktok-resync') return handleTiktokResync(req, res);

  return res.status(400).json({ error: 'Unknown or missing job. Use ?job=evidence-nudges, ?job=twitch-validate, ?job=youtube-resync, or ?job=tiktok-resync.' });
};
