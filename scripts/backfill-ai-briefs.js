// scripts/backfill-ai-briefs.js
//
// One-off backfill: finds unlocked evaluations with no ai_summary yet and
// generates one for each. Not deployed — run locally, once.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... \
//   SUPABASE_URL=https://tpcriphrfrrgywycviqv.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/backfill-ai-briefs.js
//
// Get SUPABASE_SERVICE_ROLE_KEY from Supabase dashboard → Project Settings
// → API → service_role key (same one Vercel already has configured).
const { createClient } = require('@supabase/supabase-js');
const { deriveVerdict, generateAIBrief, fetchCreatorBriefData } = require('../lib/ai-brief');

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first.');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY first — without it every brief just becomes the fallback template.');
    process.exit(1);
  }

  const admin = createClient(url, key);

  const { data: rows, error } = await admin.from('evaluations')
    .select('id, creator_id')
    .eq('unlocked', true)
    .is('ai_summary', null);

  if (error) { console.error(error); process.exit(1); }
  if (!rows || rows.length === 0) { console.log('Nothing to backfill.'); return; }

  console.log(`Backfilling ${rows.length} evaluation(s)...`);

  for (const row of rows) {
    try {
      const briefData = await fetchCreatorBriefData(admin, row.creator_id);
      if (!briefData) { console.warn(`  ${row.id}: creator not found, skipped`); continue; }

      const verdict = deriveVerdict(briefData.trustScore, briefData.brandSafety, briefData.verifiedCount);
      const { summary, brief } = await generateAIBrief({ ...briefData, verdict });

      await admin.from('evaluations').update({
        recommendation_verdict: verdict,
        recommendation_summary: summary,
        ai_summary: brief ? JSON.stringify(brief) : null,
      }).eq('id', row.id);

      console.log(`  ${row.id}: done (${brief ? 'AI brief' : 'fallback — check API key/logs'})`);
    } catch (err) {
      console.error(`  ${row.id}: failed —`, err.message);
    }
  }

  console.log('Backfill complete.');
}

main();
