// POST /api/campaign-actions?action=draft-pitch  { briefId }
// Pitch Assistant: drafts a starting pitch for a creator applying to a
// sponsor's brief, using the brief's own requirements plus the
// creator's real trust-score/platform data -- not a generic template.
// The creator can (and should) edit before submitting; this is a
// starting point, not a final pitch, same non-final-word framing as
// clause-scan's "not legal advice" note applies here as "not guaranteed
// to land the deal."
//
// GATED to Pro creators, unlike clause-scan. The distinction: clause-scan
// protects the creator from a real legal risk they didn't create and
// can't opt out of by paying more -- gating it would mean free-tier
// creators sign riskier contracts blind. Pitch Assistant is a
// competitive-advantage/growth tool with a real per-call AI cost and no
// safety stakes if a creator writes their own pitch instead. Enforced
// here, not just hidden client-side, since a client-side-only gate
// wouldn't stop a free creator calling this endpoint directly.
const { adminClient, getAuthedCreator } = require('../supabase-admin');

module.exports = async function handleDraftPitch(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const creator = await getAuthedCreator(req);
  if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

  if (creator.plan !== 'pro') {
    return res.status(403).json({ error: 'Pitch Assistant is a Pro feature.', upgradeRequired: true });
  }

  const { briefId } = req.body || {};
  if (!briefId) return res.status(400).json({ error: 'briefId is required' });

  const db = adminClient();

  try {
    const { data: brief } = await db.from('campaign_briefs').select('*').eq('id', briefId).maybeSingle();
    if (!brief) return res.status(404).json({ error: 'Brief not found' });

    const { data: platforms } = await db.from('platform_connections')
      .select('platform, follower_count').eq('creator_id', creator.id).order('follower_count', { ascending: false });

    const draft = await draftPitch({ brief, creator, platforms: platforms || [] });
    if (!draft) return res.status(200).json({ draft: null, notRun: true });

    res.status(200).json({ draft });
  } catch (err) {
    console.error('draft-pitch error:', err);
    res.status(500).json({ error: err.message || 'Could not draft pitch' });
  }
};

const GROQ_MODEL = 'llama-3.3-70b-versatile';

async function draftPitch({ brief, creator, platforms }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const platformSummary = platforms.length
    ? platforms.map(p => `${p.platform}: ${(p.follower_count || 0).toLocaleString()} followers`).join(', ')
    : 'no platforms connected yet';

  const prompt = `Write a short, genuine-sounding pitch message a content creator can send when applying to a sponsor's brief on Kitscore, a creator-sponsorship platform. This is a STARTING DRAFT the creator will read and edit before sending -- not a final message.

Brief details:
Title: ${brief.title}
Description: ${brief.description || 'n/a'}
Niche: ${brief.niche || 'n/a'}
Deliverables: ${brief.deliverables || 'n/a'}
Platforms requested: ${(brief.platforms || []).join(', ') || 'n/a'}
Budget range: ${brief.budget_range || 'n/a'}

Creator details:
Name: ${creator.display_name || 'the creator'}
Niche: ${creator.niche || 'n/a'}
Trust score: ${creator.trust_score != null ? Math.round(creator.trust_score) + '/100' : 'not yet scored'}
Verified campaigns: ${creator.verified_campaign_count || 0}
Platforms: ${platformSummary}

Write 3-5 sentences, first person, as the creator. Be specific to THIS brief (reference what it's actually asking for), not generic flattery. Mention relevant platform/follower numbers naturally if they support the pitch, and mention verified campaign count only if it's genuinely a strength (2 or more) -- don't awkwardly mention "0 verified campaigns." No greeting/sign-off boilerplate ("Dear," "Best,") -- just the pitch body text itself, since it goes straight into a form field. Do not invent facts, rates, availability, or claims not given above.

Respond ONLY with the pitch text, no preamble, no quotation marks around it, no other commentary.`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Pitch draft failed (${res.status})`);
  }

  const text = (data.choices?.[0]?.message?.content || '').trim();
  return text || null;
}
