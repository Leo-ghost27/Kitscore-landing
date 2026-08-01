// Scans a creator's recent video titles/descriptions for content that
// reads as sponsored/paid without a visible disclosure marker, as a
// supplement to (not replacement for) the self-reported paid_disclosure
// questionnaire answer. Same shape and same conservatism as
// lib/brand-safety-scan.js -- see that file for the fuller design note.
//
// IMPORTANT: this is pattern detection, not a legal compliance check.
// FTC "clear and conspicuous" disclosure depends on placement, proximity,
// and platform context that a text scanner over title/description can't
// evaluate. This only flags videos that look like undisclosed paid
// content for a human to look at directly -- it never asserts compliance
// or non-compliance on its own, and it never writes to score_components
// (see 2026-08-01-disclosure-scan.sql).

async function scanPaidDisclosure(videos) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !videos || videos.length === 0) return null;

  const sample = videos
    .slice(0, 30)
    .filter(v => v.title)
    .map(v => `- ${v.title}${v.description ? ' :: ' + v.description.slice(0, 300) : ''}`)
    .join('\n');

  if (!sample) return null;

  const prompt = `You are reviewing a YouTube creator's recent video titles and descriptions on behalf of a sponsor checking whether the creator reliably discloses paid/sponsored content.

For each video, decide two things from the text alone:
1. Does it show clear signs of being paid/sponsored content (e.g. "sponsored by", "thanks to X for partnering", a discount code tied to a named brand, "paid partnership", an affiliate link callout, "this video was made possible by")?
2. If so, is there ALSO a visible disclosure marker somewhere in the title or description (e.g. #ad, #sponsored, #paidpartnership, "paid partnership with", "sponsored by" used as the disclosure itself, "in partnership with")?

Only flag a video if (1) is true AND (2) is false -- i.e. it reads as paid content with no disclosure marker anywhere in the text you were given. Do not flag: organic brand mentions with no sponsorship language, affiliate links with no clear "paid" framing, giveaways, or videos where a disclosure marker is present anywhere in the text even if brief. Be conservative -- you are only seeing title/description text, not the video itself, so err toward NOT flagging on ambiguous cases.

Respond ONLY with JSON, no other text, in exactly this shape:
{"flagged": boolean, "suspected_titles": string[], "rationale": string}

"suspected_titles" must be the EXACT title text (copied verbatim from the list below) of every video that triggered a flag, or empty if none did -- this is used to link the admin reviewer directly to the video, so it must match a title from the list exactly, not a paraphrase. "rationale" is one sentence: cite the specific title(s) that triggered a flag and why, or state "No undisclosed paid content found in reviewed titles/descriptions." if clean.

Videos:
${sample}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Disclosure scan failed (${res.status})`);
  }

  const text = (data.content || []).map(c => c.text || '').join('').trim();
  const cleaned = text.replace(/```json|```/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fail closed -- a malformed response should never silently produce
    // a flag. Caller treats null the same as "scan didn't run."
    return null;
  }

  // Validate against the actual input rather than trusting the model's
  // output verbatim -- mirrors brand-safety-scan.js's same check.
  const knownTitles = new Set(videos.map(v => v.title).filter(Boolean));
  const suspectedTitles = Array.isArray(parsed.suspected_titles)
    ? parsed.suspected_titles.filter(t => typeof t === 'string' && knownTitles.has(t))
    : [];

  return {
    flagged: !!parsed.flagged && suspectedTitles.length > 0,
    suspectedTitles,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 500) : '',
    model: 'claude-sonnet-5',
    videoCountScanned: Math.min(videos.length, 30),
  };
}

module.exports = { scanPaidDisclosure };
