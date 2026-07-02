// POST /api/generate-evaluation  { creatorId }
// Creates an evaluation row with a deterministic verdict + template
// summary. Row is always unlocked:false — unlocking only happens via
// Stripe webhook, and that's also where the AI-generated brief gets
// attached (see stripe-webhook.js) so an API call is never spent on an
// evaluation the sponsor never actually pays for.
const { adminClient, getAuthedSponsor } = require('./_supabase-admin');
const { deriveVerdict, fallbackSummary, fetchCreatorBriefData } = require('../lib/ai-brief');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sponsor = await getAuthedSponsor(req);
    if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

    const { creatorId } = req.body || {};
    if (!creatorId) return res.status(400).json({ error: 'creatorId is required' });

    const admin = adminClient();
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
    }).select().single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    res.status(200).json({ evaluation: evalRow });
  } catch (err) {
    console.error('generate-evaluation error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
