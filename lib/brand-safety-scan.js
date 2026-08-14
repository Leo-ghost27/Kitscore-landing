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

const GROQ_MODEL = 'llama-3.3-70b-versatile';

async function scanBrandSafety(videos) {
  const apiKey = process.env.GROQ_API_KEY;
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
{"flagged": boolean, "categories": string[], "flagged_titles": string[], "rationale": string}

"categories" must only contain values from the list above, or be empty. "flagged_titles" must be the EXACT title text (copied verbatim from the list below) of every video that triggered a flag, or empty if none did -- this is used to link the admin reviewer directly to the video, so it must match a title from the list exactly, not a paraphrase. "rationale" is one sentence: cite the specific title(s) that triggered a flag, or state "No red-flag content found in reviewed titles/descriptions." if clean.

Videos:
${sample}`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 500,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Brand safety scan failed (${res.status})`);
  }

  const text = (data.choices?.[0]?.message?.content || '').trim();
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

  // Validate against the actual input rather than trusting the model's
  // output verbatim -- a title it invented wouldn't match anything in
  // creator_videos anyway, but filtering here keeps garbage out of the
  // stored record rather than relying on the join to hide it later.
  const knownTitles = new Set(videos.map(v => v.title).filter(Boolean));
  const flaggedTitles = Array.isArray(parsed.flagged_titles)
    ? parsed.flagged_titles.filter(t => typeof t === 'string' && knownTitles.has(t))
    : [];

  return {
    flagged: !!parsed.flagged && categories.length > 0,
    categories,
    flaggedTitles,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 500) : '',
    model: GROQ_MODEL,
    videoCountScanned: Math.min(videos.length, 30),
  };
}

module.exports = { scanBrandSafety, CATEGORIES };
