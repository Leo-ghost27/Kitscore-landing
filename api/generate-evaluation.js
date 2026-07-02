// POST /api/generate-evaluation  { creatorId }
// Creates an evaluation row server-side using Claude AI to generate a
// personalised decision brief from the creator's verified data.
// Row is always unlocked:false — unlocking only happens via Stripe webhook.
const { adminClient, getAuthedSponsor } = require('./_supabase-admin');

// ── Verdict rules (deterministic — not AI) ────────────────────────────────────
// Verdict is rule-based so it's consistent and auditable. AI writes the
// narrative brief that explains the verdict, not the verdict itself.
function deriveVerdict(trustScore, brandSafety, verifiedCount, confidenceRating) {
  if (trustScore >= 70 && brandSafety >= 70 && verifiedCount >= 2) return 'approve';
  if (trustScore >= 50 && brandSafety >= 50) return 'caution';
  return 'avoid';
}

// ── Claude AI brief generation ────────────────────────────────────────────────
async function generateAIBrief(creatorData) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Graceful fallback if key not set — return a structured placeholder
    return fallbackSummary(creatorData.verdict);
  }

  const {
    displayName, niche, location, trustScore, confidenceRating,
    badgeTier, verifiedCount, reliabilityScore, repeatRate,
    components, campaigns, brandSafetyAnswers, verdict,
  } = creatorData;

  const compSummary = (components || []).map(c =>
    `- ${c.label}: ${c.value}/100 (${c.status || 'pending'})`
  ).join('\n');

  const campaignSummary = (campaigns || []).slice(0, 5).map(c =>
    `- ${c.brand_name || 'Brand'} | ${c.campaign_name || ''} | ${c.status}`
  ).join('\n') || 'None on record';

  const bsFlags = (brandSafetyAnswers || [])
    .filter(a => a.flagged)
    .map(a => a.category)
    .join(', ') || 'None';

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
        model: 'claude-sonnet-4-6',
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

    // Parse JSON response
    const clean = text.replace(/```json|```/g, '').trim();
    const brief = JSON.parse(clean);

    // Build the full summary string shown in the evaluation card
    const summary = brief.summary || fallbackSummary(verdict);

    return { summary, brief };
  } catch (err) {
    console.error('AI brief generation failed:', err);
    return fallbackSummary(verdict);
  }
}

function fallbackSummary(verdict) {
  const summaries = {
    approve: 'This creator demonstrates strong credibility, a verified track record, and brand-safe content history.',
    caution: 'This creator shows reasonable credibility but has some unverified or borderline factors worth reviewing before committing.',
    avoid: 'This creator currently falls below the recommended trust and brand-safety thresholds for this evaluation.',
  };
  return { summary: summaries[verdict] || summaries.caution, brief: null };
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sponsor = await getAuthedSponsor(req);
    if (!sponsor) return res.status(401).json({ error: 'Not authenticated as a sponsor' });

    const { creatorId } = req.body || {};
    if (!creatorId) return res.status(400).json({ error: 'creatorId is required' });

    const admin = adminClient();

    // Fetch all creator data needed for AI brief
    const [
      { data: creator, error: creatorErr },
      { data: profile },
      { data: components },
      { data: campaigns },
      { data: bsAnswers },
      { data: sponsorProfile },
    ] = await Promise.all([
      admin.from('creators').select('*').eq('id', creatorId).single(),
      admin.from('profiles').select('display_name').eq('id', creatorId).single(),
      admin.from('score_components').select('*').eq('creator_id', creatorId),
      admin.from('campaigns').select('*').eq('creator_id', creatorId).eq('status', 'verified'),
      admin.from('brand_safety_answers').select('*').eq('creator_id', creatorId),
      admin.from('profiles').select('display_name, email').eq('id', sponsor.id).single(),
    ]);

    if (creatorErr || !creator) return res.status(404).json({ error: 'Creator not found' });

    // Check completeness guard — block evaluations on incomplete profiles
    if (creator.trust_score < 10) {
      return res.status(422).json({ error: 'This creator profile is incomplete and cannot be evaluated yet.' });
    }

    const compMap = {};
    (components || []).forEach(c => { compMap[c.component_key] = c.value; });

    const brandSafety = compMap.brand_safety || 0;
    const verifiedCount = (campaigns || []).length;
    const trustScore = creator.trust_score || 0;
    const confidenceRating = creator.confidence_rating || 0;

    // Deterministic verdict
    const verdict = deriveVerdict(trustScore, brandSafety, verifiedCount, confidenceRating);

    // AI brief — personalised narrative
    const displayName = profile?.display_name || 'This creator';
    const { summary, brief } = await generateAIBrief({
      displayName,
      niche: creator.niche,
      location: creator.location,
      trustScore,
      confidenceRating,
      badgeTier: creator.badge_tier || 'none',
      verifiedCount,
      reliabilityScore: creator.reliability_score || 0,
      repeatRate: creator.repeat_sponsor_rate || 0,
      components: (components || []).map(c => ({
        label: c.component_key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        value: c.value,
        status: c.status,
      })),
      campaigns,
      brandSafetyAnswers: bsAnswers,
      verdict,
    });

    // Insert evaluation row
    const { data: evalRow, error: insertErr } = await admin.from('evaluations').insert({
      sponsor_id: sponsor.id,
      creator_id: creatorId,
      unlocked: false,
      recommendation_verdict: verdict,
      recommendation_summary: summary,
      ai_summary: brief ? JSON.stringify(brief) : null,
    }).select().single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    res.status(200).json({ evaluation: evalRow });
  } catch (err) {
    console.error('generate-evaluation error:', err);
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
};
