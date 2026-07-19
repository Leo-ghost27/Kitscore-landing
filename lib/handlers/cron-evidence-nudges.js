// Weekly sweep for stale evidence (90+ days old). As of July 2026 this no
// longer sends email -- the nudge is surfaced in-app instead, via the
// banner on dashboard.html that queries evidence_uploads directly and
// shows a "N item(s) need fresh evidence" message when the creator logs
// in (see loadStaleEvidenceBanner() in dashboard.html). That in-app check
// is fully reactive and doesn't actually depend on this cron running --
// this job's only remaining job is bookkeeping: stamping
// last_expiry_nudge_sent_at so we have a record of what's been surfaced
// and when, in case that's ever needed for support/debugging.
const { adminClient } = require('../supabase-admin');

const STALE_DAYS = 90;
const RENUDGE_AFTER_DAYS = 30;

module.exports = async function handleCronEvidenceNudges(req, res) {
  try {
    const admin = adminClient();
    const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const renudgeCutoff = new Date(Date.now() - RENUDGE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await admin.from('evidence_uploads')
      .select('id, creator_id')
      .lt('uploaded_at', staleCutoff)
      .or(`last_expiry_nudge_sent_at.is.null,last_expiry_nudge_sent_at.lt.${renudgeCutoff}`);

    if (error) return res.status(500).json({ error: error.message });
    if (!rows || rows.length === 0) return res.status(200).json({ message: 'Nothing stale to mark.', marked: 0 });

    const { error: updateErr } = await admin.from('evidence_uploads')
      .update({ last_expiry_nudge_sent_at: new Date().toISOString() })
      .in('id', rows.map(r => r.id));
    if (updateErr) return res.status(500).json({ error: updateErr.message });

    res.status(200).json({ message: 'Done.', marked: rows.length });
  } catch (err) {
    console.error('cron-evidence-nudges error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
