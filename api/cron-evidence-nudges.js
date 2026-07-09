// GET /api/cron-evidence-nudges
//
// Automated version of scripts/send-evidence-expiry-nudges.js — same logic,
// running on a schedule instead of requiring someone to run it manually.
// Vercel Cron hits this on the schedule configured in vercel.json.
//
// Security: Vercel automatically sends `Authorization: Bearer ${CRON_SECRET}`
// on cron-triggered requests when CRON_SECRET is set in the project's env
// vars. This route rejects anything that doesn't match, so the endpoint
// can't be triggered by an outside request hitting the URL directly.
// Set CRON_SECRET in Vercel → Project Settings → Environment Variables
// (any long random string) before this will actually run on schedule.
const { adminClient } = require('./_supabase-admin');
const { sendEmail, evidenceExpiryEmail } = require('../lib/email');

const SITE_URL = process.env.SITE_URL || 'https://kitscore.co';
const STALE_DAYS = 90;
const RENUDGE_AFTER_DAYS = 30;

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

module.exports = async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const admin = adminClient();
    const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const renudgeCutoff = new Date(Date.now() - RENUDGE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: rows, error } = await admin.from('evidence_uploads')
      .select('id, creator_id, file_name, uploaded_at, last_expiry_nudge_sent_at')
      .lt('uploaded_at', staleCutoff)
      .or(`last_expiry_nudge_sent_at.is.null,last_expiry_nudge_sent_at.lt.${renudgeCutoff}`);

    if (error) return res.status(500).json({ error: error.message });
    if (!rows || rows.length === 0) return res.status(200).json({ message: 'Nothing stale to nudge.', sent: 0, skipped: 0 });

    const byCreator = new Map();
    for (const row of rows) {
      if (!byCreator.has(row.creator_id)) byCreator.set(row.creator_id, []);
      byCreator.get(row.creator_id).push(row);
    }

    let sent = 0, skipped = 0;
    const log = [];

    for (const [creatorId, items] of byCreator) {
      const [{ data: profile }, { data: creatorRow }] = await Promise.all([
        admin.from('profiles').select('display_name, email').eq('id', creatorId).maybeSingle(),
        admin.from('creators').select('plan').eq('id', creatorId).maybeSingle(),
      ]);

      if (!profile?.email) { skipped++; log.push(`Skipped ${creatorId} — no email on file.`); continue; }

      // Proactive email reminders are a Pro perk. Free creators still see
      // the "Expiring soon"/"Expired" badge in evidence.html (free/informational)
      // — they just don't get emailed automatically.
      if (creatorRow?.plan !== 'pro') { skipped++; log.push(`Skipped ${profile.email} — free plan.`); continue; }

      const result = await sendEmail({
        to: profile.email,
        ...evidenceExpiryEmail({
          creatorName: profile.display_name || 'there',
          items: items.map(i => ({ file_name: i.file_name, uploadedDate: fmtDate(i.uploaded_at) })),
          evidenceUrl: `${SITE_URL}/app/evidence.html`,
        }),
      });

      if (result?.error || result?.skipped) { skipped++; log.push(`Failed/skipped for ${profile.email}: ${JSON.stringify(result)}`); continue; }

      await admin.from('evidence_uploads')
        .update({ last_expiry_nudge_sent_at: new Date().toISOString() })
        .in('id', items.map(i => i.id));

      sent++;
      log.push(`Nudged ${profile.email} about ${items.length} stale item(s).`);
    }

    res.status(200).json({ message: 'Done.', sent, skipped, log });
  } catch (err) {
    console.error('cron-evidence-nudges error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
