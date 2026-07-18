// Scans a creator's recent video titles/descriptions for brand-safety red
// flags, as a supplement to (not replacement for) the self-reported
// brand_safety_answers questionnaire. Deliberately narrow: only categories
// reliably inferable from short text, and conservative by instruction --
// a false positive costs a creator real score points (pending admin
// review), so the prompt is explicit about not flagging incidental
// mentions or context-appropriate content.
//
// Design note (2026-07-13): industry research on brand-safety workflows
// consistently found "automated flagging, human final call" as the norm
// for anything affecting money/reputation -- this function only flags,
// it never writes to score_components directly. That's the caller's job,
// gated by admin approval (see fn_admin_apply_brand_safety_scan).

const CATEGORIES = ['gambling', 'adult_content', 'hate_speech_or_extremism', 'graphic_violence', 'illegal_drugs', 'weapons'];

async function scanBrandSafety(videos) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !videos || videos.length === 0) return null;

  const sample = videos
    .slice(0, 30)
    .filter(v => v.title)
    .map(v => `- ${v.title}${v.description ? ' :: ' + v.description.slice(0, 200) : ''}`)
    .join('\n');

  if (!sample) return null;

  const prompt = `You are reviewing a YouTube creator's recent video titles and descriptions for brand-safety red flags, on behalf of a sponsor deciding whether to work with them.

Categories to flag, ONLY if there is clear, explicit evidence: ${CATEGORIES.join(', ')}.

Be conservative. Do not flag: incidental mentions, journalistic/educational discussion of a topic, fictional/gaming context (e.g. a video game with "weapons" in the title is not a weapons flag), or borderline language. Only flag content that a reasonable sponsor would consider an actual brand-safety concern if they saw it directly.

Respond ONLY with JSON, no other text, in exactly this shape:
{"flagged": boolean, "categories": string[], "rationale": string}

"categories" must only contain values from the list above, or be empty. "rationale" is one sentence: cite the specific title(s) that triggered a flag, or state "No red-flag content found in reviewed titles/descriptions." if clean.

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
    throw new Error(data?.error?.message || `Brand safety scan failed (${res.status})`);
  }

  const text = (data.content || []).map(c => c.text || '').join('').trim();
  const cleaned = text.replace(/```json|```/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fail closed -- a malformed response should never silently miswrite
    // a score. Caller treats null the same as "scan didn't run."
    return null;
  }

  const categories = Array.isArray(parsed.categories)
    ? parsed.categories.filter(c => CATEGORIES.includes(c))
    : [];

  return {
    flagged: !!parsed.flagged && categories.length > 0,
    categories,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 500) : '',
    model: 'claude-sonnet-5',
    videoCountScanned: Math.min(videos.length, 30),
  };
}

module.exports = { scanBrandSafety, CATEGORIES };
