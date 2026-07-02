// lib/ai-brief.js
// Shared logic for the deterministic verdict + Claude-generated decision
// brief. The AI call is intentionally NOT triggered when a sponsor first
// requests an evaluation (that would burn an API call on every abandoned,
// unpaid evaluation). It's triggered once, from the Stripe webhook, right
// after a payment actually confirms — see stripe-webhook.js.

const BRAND_SAFETY_QUESTIONS = {
  family_safe: 'Family-safe content',
  political: 'Political content frequency',
  gambling: 'Gambling promotion history',
  adult: 'Adult/mature content',
  profanity: 'Profanity frequency',
};

// Verdict is rule-based so it's consistent and auditable. AI writes the
// narrative brief that explains the verdict, not the verdict itself.
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

// Calls Claude to write the narrative brief. Falls back to a fixed
// template sentence if ANTHROPIC_API_KEY isn't set or the call fails —
// never throws, so it never blocks the caller (evaluation creation or
// payment-confirmation webhook).
async function generateAIBrief(creatorData) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const verdict = creatorData.verdict;
  if (!apiKey) return fallbackSummary(verdict);

  const {
    displayName, niche, location, trustScore, confidenceRating,
    badgeTier, verifiedCount, reliabilityScore, repeatRate,
    components, campaigns, brandSafetyAnswers, penaltyLookup,
  } = creatorData;

  const compSummary = (components || []).map(c =>
    `- ${c.label}: ${c.value}/100 (${c.status || 'pending'})`
  ).join('\n');

  const campaignSummary = (campaigns || []).slice(0, 5).map(c =>
    `- ${c.name || 'Campaign'} | ${c.status}`
  ).join('\n') || 'None on record';

  const flaggedLabels = (brandSafetyAnswers || [])
    .filter(a => (penaltyLookup?.[`${a.question_key}::${a.answer}`] || 0) > 0)
    .map(a => BRAND_SAFETY_QUESTIONS[a.question_key] || a.question_key);
  const bsFlags = flaggedLabels.length ? flaggedLabels.join(', ') : 'None';

  const prompt = `You are Kitscore AI, a sponsorship intelligence analyst. Generate a concise, professional decision brief for a brand sponsor evaluating a creator partnership.

CREATOR DATA:
Name: ${displayName}
Niche: ${niche || 'Not specified'}
Location: ${location || 'Not specified'}
Trust Score: ${trustScore}/100
Confidence Rating: ${confidenceRating}% (how much of the score is backed by verified data)
Badge Tier: ${badgeTier}
Verified Campaigns: ${verifiedCount}
Reliability Score: ${reliabilityScore}/100
Repeat Sponsor Rate: ${repeatRate}%

SCORE COMPONENTS:
${compSummary}

VERIFIED CAMPAIGNS (sample):
${campaignSummary}

BRAND SAFETY FLAGS:
${bsFlags}

VERDICT: ${verdict.toUpperCase()}

Write a decision brief with these exact sections. Be specific — use the actual numbers and data above. Do not be generic. Keep each section 1-3 sentences max.

Use ONLY the data provided above. Do not invent statistics, industry benchmarks, follower counts, engagement rates, or comparisons that were not supplied to you. If data for a section is thin, say so plainly rather than filling the gap with an invented figure — an unsupported claim about a real person is a real-world liability, not a style choice.

Format your response as JSON with these exact keys:
{
  "summary": "2-sentence overall summary citing the trust score and verified campaign count",
  "audience_fit": "1-2 sentences on audience fit based on niche and location",
  "risk_assessment": "1-2 sentences on risk level based on brand safety score and any flags",
  "confidence_note": "1 sentence explaining what the confidence rating means for this evaluation",
  "recommendation": "1 clear sentence — what the sponsor should do and why"
}

Return only valid JSON. No preamble, no markdown, no explanation.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error('Claude API error:', response.status, await response.text());
      return fallbackSummary(verdict);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const brief = JSON.parse(clean);
    const summary = brief.summary || fallbackSummary(verdict).summary;

    return { summary, brief };
  } catch (err) {
    console.error('AI brief generation failed:', err);
    return fallbackSummary(verdict);
  }
}

module.exports = { deriveVerdict, fallbackSummary, fetchCreatorBriefData, generateAIBrief };
