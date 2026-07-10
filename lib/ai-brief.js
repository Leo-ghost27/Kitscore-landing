// lib/ai-brief.js
// Shared logic for deriving a sponsor-facing verdict + summary sentence for
// an evaluation. This used to also generate a Claude-written narrative
// brief (ai_summary) via ANTHROPIC_API_KEY -- removed July 2026 to drop the
// API-key dependency and the "AI-generated decision brief" marketing claim.
// The verdict + summary are now, and always were for the verdict itself,
// fully deterministic/rule-based -- see deriveVerdict() and
// fallbackSummary() below. Called from generate-evaluation.js (draft) and
// stripe-webhook.js (final, post-payment refresh).

// Verdict is rule-based so it's consistent and auditable.
function deriveVerdict(trustScore, brandSafety, verifiedCount) {
  if (trustScore >= 70 && brandSafety >= 70 && verifiedCount >= 2) return 'approve';
  if (trustScore >= 50 && brandSafety >= 50) return 'caution';
  return 'avoid';
}

function fallbackSummary(verdict) {
  const summaries = {
    approve: 'This creator demonstrates strong credibility, a verified track record, and brand-safe content history.',
    caution: 'This creator shows reasonable credibility but has some unverified or borderline factors worth reviewing before committing.',
    avoid: 'This creator currently falls below the recommended trust and brand-safety thresholds for this evaluation.',
  };
  return { summary: summaries[verdict] || summaries.caution, brief: null };
}

// Fetches everything needed to derive a verdict and (later) generate a
// brief. Returns null if the creator doesn't exist.
async function fetchCreatorBriefData(admin, creatorId) {
  const [
    { data: creator, error: creatorErr },
    { data: profile },
    { data: components },
    { data: campaigns },
    { data: bsAnswers },
    { data: bsPenalties },
  ] = await Promise.all([
    admin.from('creators').select('*').eq('id', creatorId).single(),
    admin.from('profiles').select('display_name').eq('id', creatorId).single(),
    admin.from('score_components').select('*').eq('creator_id', creatorId),
    admin.from('campaigns').select('*').eq('creator_id', creatorId).eq('status', 'verified'),
    admin.from('brand_safety_answers').select('*').eq('creator_id', creatorId),
    admin.from('brand_safety_penalties').select('*'),
  ]);

  if (creatorErr || !creator) return null;

  const compMap = {};
  (components || []).forEach(c => { compMap[c.component_key] = c.value; });

  const penaltyLookup = {};
  (bsPenalties || []).forEach(p => { penaltyLookup[`${p.question_key}::${p.answer}`] = Number(p.penalty) || 0; });

  return {
    creator,
    displayName: profile?.display_name || 'This creator',
    niche: creator.niche,
    location: creator.location,
    trustScore: creator.trust_score || 0,
    confidenceRating: creator.confidence || 0,
    badgeTier: creator.badge_tier || 'none',
    verifiedCount: (campaigns || []).length,
    reliabilityScore: creator.reliability_score || 0,
    repeatRate: creator.repeat_sponsor_rate || 0,
    brandSafety: compMap.brand_safety || 0,
    components: (components || []).map(c => ({
      label: c.component_key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value: c.value,
      status: c.status,
    })),
    campaigns,
    brandSafetyAnswers: bsAnswers,
    penaltyLookup,
  };
}

module.exports = { deriveVerdict, fallbackSummary, fetchCreatorBriefData };
