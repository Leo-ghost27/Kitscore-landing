// POST /api/generate-evaluation  { creatorId }
// Creates an evaluation row with a deterministic verdict + template
// summary. Row is always unlocked:false — unlocking only happens via
// Stripe webhook, and that's also where the AI-generated brief gets
// attached (see stripe-webhook.js) so an API call is never spent on an
// evaluation the sponsor never actually pays for.
const { adminClient, getAuthedSponsor } = require('../lib/supabase-admin');
const { deriveVerdict, fallbackSummary, fetchCreatorBriefData } = require('../lib/ai-brief');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sponsor = await getAuthedSponsor(req);
    if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

    const { creatorId, teamId } = req.body || {};
    if (!creatorId) return res.status(400).json({ error: 'creatorId is required' });

    const admin = adminClient();

    // If this sponsor is on a team, tag the evaluation with the team so the
    // internal review workflow (draft -> pending_approval -> approved/rejected)
    // in evaluate.html actually activates. Previously this was never set,
    // so that entire UI was dead code for every team.
    //
    // A sponsor can belong to up to 2 teams, so this can no longer just grab
    // "the" membership -- the client sends which team is active (same
    // selection the switcher on team.html drives), and this verifies that
    // membership actually exists server-side rather than trusting the
    // client's word for it. If no teamId is sent (or it doesn't check out),
    // falls back to whatever membership exists -- covers the common single-
    // team case without requiring every caller to know about teamId.
    //
    // Errors from this query used to be silently discarded (only `data` was
    // destructured), which made "the query failed" indistinguishable from
    // "this sponsor isn't on a team" -- both fell through to team_id: null
    // with nothing logged anywhere. Found via live testing: a team member's
    // evaluation ended up with team_id NULL despite her team_members row
    // existing and predating the evaluation by a full day. Failing loudly
    // here instead of silently mistagging the row.
    let membershipQuery = admin.from('team_members').select('team_id').eq('sponsor_id', sponsor.id);
    membershipQuery = teamId ? membershipQuery.eq('team_id', teamId).maybeSingle() : membershipQuery.limit(1).maybeSingle();
    const { data: membership, error: membershipErr } = await membershipQuery;
    if (membershipErr) {
      return res.status(500).json({ error: 'Could not verify team membership: ' + membershipErr.message });
    }

    // This endpoint used to unconditionally INSERT, meaning it only ever ran
    // once per (sponsor, creator) pair -- the button that calls it is only
    // wired up for the very first visit (see evaluate.html: generateAndUnlock()
    // only fires when no evaluation exists yet). If that one insert ever
    // missed the team_id for any reason, the row stayed orphaned forever --
    // nothing else in the app would ever revisit it. Checking for an existing
    // row first and backfilling team_id on it (rather than assuming "no
    // existing row" is the only case) makes this self-healing on top of the
    // loud-error fix above, instead of relying on that fix never being
    // needed again.
    const { data: existing, error: existingErr } = await admin.from('evaluations')
      .select('*').eq('creator_id', creatorId).eq('sponsor_id', sponsor.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existingErr) return res.status(500).json({ error: existingErr.message });

    if (existing) {
      if (!existing.team_id && membership?.team_id) {
        const { data: backfilled, error: backfillErr } = await admin.from('evaluations')
          .update({ team_id: membership.team_id, approval_status: 'draft' })
          .eq('id', existing.id).select().single();
        if (backfillErr) return res.status(500).json({ error: backfillErr.message });
        return res.status(200).json({ evaluation: backfilled });
      }
      return res.status(200).json({ evaluation: existing });
    }

    const data = await fetchCreatorBriefData(admin, creatorId);
    if (!data) return res.status(404).json({ error: 'Creator not found' });

    // Check completeness guard — block evaluations on incomplete profiles
    if (data.trustScore < 10) {
      return res.status(422).json({ error: 'This creator profile is incomplete and cannot be evaluated yet.' });
    }

    const verdict = deriveVerdict(data.trustScore, data.brandSafety, data.verifiedCount);
    const { summary } = fallbackSummary(verdict);

    const { data: evalRow, error: insertErr } = await admin.from('evaluations').insert({
      sponsor_id: sponsor.id,
      creator_id: creatorId,
      unlocked: false,
      recommendation_verdict: verdict,
      recommendation_summary: summary,
      ai_summary: null,
      team_id: membership?.team_id || null,
      approval_status: membership?.team_id ? 'draft' : null,
    }).select().single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    res.status(200).json({ evaluation: evalRow });
  } catch (err) {
    console.error('generate-evaluation error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
