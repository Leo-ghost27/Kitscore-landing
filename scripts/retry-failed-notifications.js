// scripts/retry-failed-notifications.js
//
// Retries anything logged in notification_failures (currently just dispute
// emails — see api/notify-dispute.js). Not deployed — run locally, as
// often as makes sense. If dispute volume grows enough that this needs to
// run automatically, wire it up as a Vercel Cron hitting a thin API route
// that calls the same logic; not built yet since volume doesn't justify it.
//
// Usage:
//   RESEND_API_KEY=re_... \
//   RESEND_FROM_EMAIL=hello@kitscore.co \
//   SUPABASE_URL=https://tpcriphrfrrgywycviqv.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/retry-failed-notifications.js
//
// Get SUPABASE_SERVICE_ROLE_KEY from Supabase dashboard → Project Settings
// → API → service_role key (same one Vercel already has configured).
const { createClient } = require('@supabase/supabase-js');
const { sendEmail, disputeNotificationEmail } = require('../lib/email');

const SITE_URL = process.env.SITE_URL || 'https://kitscore.co';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first.');
    process.exit(1);
  }
  if (!process.env.RESEND_API_KEY) {
    console.error('Set RESEND_API_KEY first — without it every retry will just fail again.');
    process.exit(1);
  }

  const admin = createClient(url, key);

  const { data: rows, error } = await admin.from('notification_failures')
    .select('*').is('resolved_at', null).order('created_at', { ascending: true });

  if (error) { console.error(error); process.exit(1); }
  if (!rows || rows.length === 0) { console.log('Nothing queued.'); return; }

  console.log(`Retrying ${rows.length} queued notification(s)...`);
  let resolved = 0, stillFailing = 0;

  for (const row of rows) {
    if (row.kind !== 'dispute_notification') {
      console.log(`Skipping ${row.id} — unknown kind "${row.kind}", nothing to retry it with yet.`);
      continue;
    }
    if (!row.campaign_id) {
      console.log(`Skipping ${row.id} — no campaign_id to look up.`);
      continue;
    }

    const { data: campaign } = await admin.from('campaigns')
      .select('id, name, sponsor_id, dispute_reason, status').eq('id', row.campaign_id).maybeSingle();

    if (!campaign || campaign.status !== 'disputed') {
      // Dispute was withdrawn or resolved since this failure was logged —
      // nothing left to notify about.
      await admin.from('notification_failures').update({ resolved_at: new Date().toISOString() }).eq('id', row.id);
      resolved++;
      continue;
    }

    // creators.id / sponsors.id share their primary key with profiles.id
    // (see the profiles/creators/sponsors FK chain), so both are direct
    // lookups against profiles — same as api/notify-dispute.js.
    const [{ data: sponsorProfile }, { data: creatorProfile }] = await Promise.all([
      admin.from('profiles').select('email').eq('id', campaign.sponsor_id).single(),
      admin.from('profiles').select('display_name').eq('id', campaign.creator_id).single(),
    ]);

    const toEmail = row.recipient_email || sponsorProfile?.email;
    if (!toEmail) {
      console.log(`Skipping ${row.id} — still no email on file for sponsor.`);
      await admin.from('notification_failures')
        .update({ attempts: row.attempts + 1, last_attempted_at: new Date().toISOString() }).eq('id', row.id);
      stillFailing++;
      continue;
    }

    const result = await sendEmail({
      to: toEmail,
      ...disputeNotificationEmail({
        campaignName: campaign.name,
        creatorName: creatorProfile?.display_name || 'A creator',
        disputeReason: campaign.dispute_reason || 'No reason given.',
        campaignsUrl: `${SITE_URL}/app/campaigns.html`,
      }),
    });

    if (result?.error) {
      console.log(`Still failing for ${row.id}: ${JSON.stringify(result.error)}`);
      await admin.from('notification_failures')
        .update({ attempts: row.attempts + 1, last_attempted_at: new Date().toISOString(), error: JSON.stringify(result.error).slice(0, 2000) })
        .eq('id', row.id);
      stillFailing++;
    } else {
      console.log(`Sent for ${row.id} (campaign "${campaign.name}") to ${toEmail}.`);
      await admin.from('notification_failures').update({ resolved_at: new Date().toISOString() }).eq('id', row.id);
      resolved++;
    }
  }

  console.log(`Done. Resolved: ${resolved}. Still failing: ${stillFailing}.`);
}

main();
