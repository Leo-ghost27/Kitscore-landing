// POST /api/generate-evaluation  { creatorId }
// Creates an evaluation row server-side, always unlocked:false. Unlocking only
// ever happens from the Stripe webhook after a confirmed payment.
const { adminClient, getAuthedSponsor } = require('./_supabase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sponsor = await getAuthedSponsor(req);
    if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

    const { creatorId } = req.body || {};
    if (!creatorId) return res.status(400).json({ error: 'creatorId is required' });

    const admin = adminClient();
    const { data: creator, error: creatorErr } = await admin.from('creators')
      .select('trust_score').eq('id', creatorId).single();
    if (creatorErr || !creator) return res.status(404).json({ error: 'Creator not found' });

    const { data: components } = await admin.from('score_components').select('*').eq('creator_id', creatorId);
    const brandSafety = (components || []).find(c => c.component_key === 'brand_safety')?.value || 0;

    // Placeholder verdict logic — see status doc for what a production rules
    // engine should weigh (dispute history, recency, category fit to brief, etc).
    const verdict = (creator.trust_score >= 70 && brandSafety >= 70) ? 'approve'
      : (creator.trust_score >= 50 ? 'caution' : 'avoid');
    const summary = verdict === 'approve'
      ? 'This creator demonstrates strong credibility, a verified track record, and brand-safe content history.'
      : verdict === 'caution'
      ? 'This creator shows reasonable credibility but has some unverified or borderline factors worth reviewing before committing.'
      : 'This creator currently falls below the recommended trust and brand-safety thresholds for this evaluation.';

    const { data: evalRow, error: insertErr } = await admin.from('evaluations').insert({
      sponsor_id: sponsor.id, creator_id: creatorId, unlocked: false,
      recommendation_verdict: verdict, recommendation_summary: summary,
    }).select().single();
    if (insertErr) return res.status(500).json({ error: insertErr.message });

    res.status(200).json({ evaluation: evalRow });
  } catch (err) {
    console.error('generate-evaluation error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
