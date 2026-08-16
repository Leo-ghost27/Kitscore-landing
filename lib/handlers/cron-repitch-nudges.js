// Handler for GET /api/cron?job=repitch-nudges
//
// Turns the existing Performance Recap artifact (a completed, mutually-
// confirmed campaign) from passive to active: nudges the creator that
// it's been a while since a campaign with a given sponsor wrapped up,
// and that's often a good moment to check back in. One-time nudge per
// campaign -- see the migration comment on
// campaigns.last_repitch_nudge_sent_at for why this doesn't repeat like
// cron-escrow-stuck-nudge.js's daily nudge does.
//
// Pro-gated, same reasoning as draft-pitch.js and counter-offer-
// assist.js: this is a competitive-advantage/growth nudge, not a
// safety-relevant one -- gating it doesn't put a free-tier creator at
// risk the way gating clause-scan would. Filtered in JS rather than a
// `.eq('creators.plan', ...)` embedded-table filter -- no existing
// handler in this codebase relies on that PostgREST filter form, so
// this matches the established pattern (see alreadyReengaged below,
// same JS-side-filter approach) instead of introducing an untested one.
//
// Window is 5-7 months, not "150+ days and counting forever": a nudge
// this old-feeling only makes sense in a window, not as a one-time
// cutoff that then matches every campaign older than it too.
//
// v1 does NOT check for a newer brief_application to the same sponsor
// (only a newer campaign) -- brief_applications has just 2 rows in
// production right now, so that cross-check isn't worth the extra
// query yet. If a creator re-engages via a brand-new application that
// hasn't become a campaign yet, they may still get nudged once here;
// low cost given the nudge is informational, not pushy, and one-time.
const { adminClient } = require('../supabase-admin');
const { sendEmail, repitchNudgeEmail } = require('../email');

const MIN_MONTHS = 5;
const MAX_MONTHS = 7;

module.exports = async function handleCronRepitchNudges(req, res) {
  try {
    const admin = adminClient();
    const now = Date.now();
    const windowStart = new Date(now - MAX_MONTHS * 30 * 24 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(now - MIN_MONTHS * 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: allEligible, error } = await admin.from('campaigns')
      .select('id, name, creator_id, sponsor_id, completed_at, creator_confirmed, sponsor_confirmed, last_repitch_nudge_sent_at, sponsors!inner(company_name), creators!inner(plan, profiles!inner(email, display_name))')
      .eq('creator_confirmed', true)
      .eq('sponsor_confirmed', true)
      .is('last_repitch_nudge_sent_at', null)
      .gte('completed_at', windowStart)
      .lte('completed_at', windowEnd);

    if (error) throw error;

    const campaigns = (allEligible || []).filter(c => c.creators?.plan === 'pro');
    if (!campaigns.length) return res.status(200).json({ ok: true, nudged: 0 });

    // Skip any pair where the creator already has a newer campaign with
    // this same sponsor -- they don't need a nudge to check back in
    // with someone they're already working with again.
    const { data: newerCampaigns } = await admin.from('campaigns')
      .select('creator_id, sponsor_id, created_at');

    const alreadyReengaged = new Set(
      (newerCampaigns || [])
        .filter(nc => campaigns.some(c => c.creator_id === nc.creator_id && c.sponsor_id === nc.sponsor_id && nc.created_at > c.completed_at))
        .map(nc => `${nc.creator_id}:${nc.sponsor_id}`)
    );

    const origin = `https://${req.headers.host || 'kitscore.co'}`;
    const briefsUrl = `${origin}/app/briefs.html`;

    let nudged = 0;
    for (const c of campaigns) {
      if (alreadyReengaged.has(`${c.creator_id}:${c.sponsor_id}`)) continue;

      const creatorEmail = c.creators?.profiles?.email;
      if (!creatorEmail) continue;

      const monthsAgo = Math.round((now - new Date(c.completed_at).getTime()) / (1000 * 60 * 60 * 24 * 30));

      const result = await sendEmail({
        to: creatorEmail,
        ...repitchNudgeEmail({
          creatorName: c.creators?.profiles?.display_name || 'there',
          sponsorCompanyName: c.sponsors?.company_name || 'that sponsor',
          campaignName: c.name || 'your campaign',
          monthsAgo,
          briefsUrl,
        }),
      });

      if (!result?.error) {
        await admin.from('campaigns').update({ last_repitch_nudge_sent_at: new Date().toISOString() }).eq('id', c.id);
        nudged++;
      }
    }

    res.status(200).json({ ok: true, eligibleTotal: allEligible.length, eligiblePro: campaigns.length, nudged });
  } catch (err) {
    console.error('cron repitch-nudges error:', err);
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
};
