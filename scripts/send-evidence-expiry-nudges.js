// scripts/send-evidence-expiry-nudges.js
//
// MANUAL FALLBACK — the primary path is now api/cron-evidence-nudges.js,
// running automatically via Vercel Cron (see vercel.json, weekly Monday
// 9am UTC). This script does the same thing by hand — useful for testing
// without waiting a week, or as a backup if the cron ever needs debugging.
//
// Finds evidence_uploads older than 90 days that haven't been nudged in
// the last 30 days, groups them by creator, and sends one reminder email
// per creator (not one per item).
//
// Usage:
//   RESEND_API_KEY=re_... \
//   RESEND_FROM_EMAIL=hello@kitscore.co \
//   SUPABASE_URL=https://tpcriphrfrrgywycviqv.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/send-evidence-expiry-nudges.js
//
// Get SUPABASE_SERVICE_ROLE_KEY from Supabase dashboard → Project Settings
// → API → service_role key (same one Vercel already has configured).
const { createClient } = require('@supabase/supabase-js');
const { sendEmail, evidenceExpiryEmail } = require('../lib/email');

const SITE_URL = process.env.SITE_URL || 'https://kitscore.co';
const STALE_DAYS = 90;
const RENUDGE_AFTER_DAYS = 30;

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first.');
    process.exit(1);
  }
  if (!process.env.RESEND_API_KEY) {
    console.error('Set RESEND_API_KEY first — without it this will just skip every send.');
    process.exit(1);
  }

  const admin = createClient(url, key);

  const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const renudgeCutoff = new Date(Date.now() - RENUDGE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Stale = uploaded before the 90-day cutoff, AND either never nudged or
  // last nudged more than 30 days ago (so a creator with several stale
  // items doesn't get an email every time this script runs).
  const { data: rows, error } = await admin.from('evidence_uploads')
    .select('id, creator_id, file_name, uploaded_at, last_expiry_nudge_sent_at')
    .lt('uploaded_at', staleCutoff)
    .or(`last_expiry_nudge_sent_at.is.null,last_expiry_nudge_sent_at.lt.${renudgeCutoff}`);

  if (error) { console.error(error); process.exit(1); }
  if (!rows || rows.length === 0) { console.log('Nothing stale to nudge.'); return; }

  const byCreator = new Map();
  for (const row of rows) {
    if (!byCreator.has(row.creator_id)) byCreator.set(row.creator_id, []);
    byCreator.get(row.creator_id).push(row);
  }

  console.log(`Found ${rows.length} stale item(s) across ${byCreator.size} creator(s).`);
  let sent = 0, skipped = 0;

  for (const [creatorId, items] of byCreator) {
    const { data: profile } = await admin.from('profiles')
      .select('display_name, email').eq('id', creatorId).maybeSingle();
    const { data: creatorRow } = await admin.from('creators')
      .select('plan').eq('id', creatorId).maybeSingle();

    if (!profile?.email) {
      console.log(`Skipping creator ${creatorId} — no email on file.`);
      skipped++;
      continue;
    }

    // Proactive email reminders are a Pro perk. Free creators still see the
    // "Expiring soon"/"Expired" badge in the evidence.html UI (that stays
    // free/informational) — they just don't get emailed automatically.
    if (creatorRow?.plan !== 'pro') {
      console.log(`Skipping ${profile.email} — free plan, no email nudge (still sees the in-app badge).`);
      skipped++;
      continue;
    }

    const result = await sendEmail({
      to: profile.email,
      ...evidenceExpiryEmail({
        creatorName: profile.display_name || 'there',
        items: items.map(i => ({ file_name: i.file_name, uploadedDate: fmtDate(i.uploaded_at) })),
        evidenceUrl: `${SITE_URL}/app/evidence.html`,
      }),
    });

    if (result?.error || result?.skipped) {
      console.log(`Failed/skipped for creator ${creatorId}: ${JSON.stringify(result)}`);
      skipped++;
      continue;
    }

    const ids = items.map(i => i.id);
    await admin.from('evidence_uploads')
      .update({ last_expiry_nudge_sent_at: new Date().toISOString() })
      .in('id', ids);

    console.log(`Nudged ${profile.email} about ${items.length} stale item(s).`);
    sent++;
  }

  console.log(`Done. Emails sent: ${sent}. Skipped: ${skipped}.`);
}

main();
