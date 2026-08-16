// POST /api/campaign-actions?action=counter-offer-assist  { applicationId, targetRate, reason }
// Counter-Offer Assist: when a creator thinks a brief's offer is too
// low, drafts a counter-offer message using the brief's own details
// plus the creator's real trust-score/platform data -- same "starting
// point, not final word" framing as draft-pitch.
//
// Deliberately NOT compared against an automated rate-benchmark number.
// There is no real benchmark data source in this codebase yet -- the
// only place "benchmark" appears is a disclaimer line in the PDF
// generator's boilerplate text, and the live contracts table has 5
// rows, nowhere near enough real transactions to compute a defensible
// per-niche/per-tier number. Claiming "you're below benchmark" without
// real data behind it would be the same kind of unverifiable claim
// already caught and removed from the marketing site (the "500+
// creators" line) -- not repeating that here. Instead: the CREATOR
// supplies the number they want and why: AI drafts the ask, doesn't
// invent the number.
//
// Gated to Pro, same reasoning as draft-pitch: real per-call AI cost,
// no safety stakes if a creator writes their own counter instead.
const { adminClient, getAuthedCreator } = require('../supabase-admin');

module.exports = async function handleCounterOfferAssist(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const creator = await getAuthedCreator(req);
  if (!creator) return res.status(401).json({ error: 'Not authenticated as a creator' });

  if (creator.plan !== 'pro') {
    return res.status(403).json({ error: 'Counter-Offer Assist is a Pro feature.', upgradeRequired: true });
  }

  const { applicationId, targetRate, reason } = req.body || {};
  if (!applicationId) return res.status(400).json({ error: 'applicationId is required' });
  if (!targetRate) return res.status(400).json({ error: 'targetRate is required -- Kitscore does not auto-generate a target number, you set it' });

  const db = adminClient();

  try {
    const { data: application } = await db.from('brief_applications')
      .select('id, creator_id, proposed_rate, status, brief_id, campaign_briefs(title, description, niche, deliverables, platforms, budget_range)')
      .eq('id', applicationId).maybeSingle();

    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (application.creator_id !== creator.id) return res.status(403).json({ error: 'Not your application' });

    const brief = application.campaign_briefs;
    if (!brief) return res.status(404).json({ error: 'Brief not found' });

    const { data: platforms } = await db.from('platform_connections')
      .select('platform, follower_count').eq('creator_id', creator.id).order('follower_count', { ascending: false });

    const draft = await draftCounterOffer({
      brief,
      creator,
      platforms: platforms || [],
      currentOffer: application.proposed_rate,
      targetRate,
      reason,
    });
    if (!draft) return res.status(200).json({ draft: null, notRun: true });

    res.status(200).json({ draft });
  } catch (err) {
    console.error('counter-offer-assist error:', err);
    res.status(500).json({ error: err.message || 'Could not draft counter-offer' });
  }
};

const GROQ_MODEL = 'llama-3.3-70b-versatile';

async function draftCounterOffer({ brief, creator, platforms, currentOffer, targetRate, reason }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const platformSummary = platforms.length
    ? platforms.map(p => `${p.platform}: ${(p.follower_count || 0).toLocaleString()} followers`).join(', ')
    : 'no platforms connected yet';

  const prompt = `Write a short, polite, confident counter-offer message a content creator can send back to a sponsor on Kitscore, a creator-sponsorship platform, when the sponsor's initial offer is lower than what the creator wants. This is a STARTING DRAFT the creator will read and edit before sending -- not a final message.

Brief details:
Title: ${brief.title}
Description: ${brief.description || 'n/a'}
Niche: ${brief.niche || 'n/a'}
Deliverables: ${brief.deliverables || 'n/a'}
Platforms requested: ${(brief.platforms || []).join(', ') || 'n/a'}
Sponsor's stated budget range: ${brief.budget_range || 'n/a'}
Current offer on the table: ${currentOffer || 'n/a'}

Creator details:
Name: ${creator.display_name || 'the creator'}
Niche: ${creator.niche || 'n/a'}
Trust score: ${creator.trust_score != null ? Math.round(creator.trust_score) + '/100' : 'not yet scored'}
Verified campaigns: ${creator.verified_campaign_count || 0}
Platforms: ${platformSummary}

What the creator wants instead: ${targetRate}
Creator's own reason for asking for this (may be blank): ${reason || 'not given -- do not invent one'}

Write 3-5 sentences, first person, as the creator. Politely counter with the requested number, back it up ONLY with facts given above (trust score, verified campaigns, platform reach, or the creator's own stated reason) -- do not invent achievements, exclusivity, competing offers, or urgency not given. Confident but not confrontational; this is a negotiation, not an ultimatum. No greeting/sign-off boilerplate -- just the message body, since it goes straight into a form field.

Respond ONLY with the counter-offer text, no preamble, no quotation marks around it, no other commentary.`;

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
    throw new Error(data?.error?.message || `Counter-offer draft failed (${res.status})`);
  }

  const text = (data.choices?.[0]?.message?.content || '').trim();
  return text || null;
}
