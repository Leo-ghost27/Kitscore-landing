// Checks a contract's exclusivity terms against the SAME creator's
// other fully_signed contracts for a plausible overlap -- e.g. an
// exclusivity clause locking the creator into one skincare brand for
// 90 days, while a second, newer contract with a competing skincare
// brand is being signed inside that window.
//
// Same shape, same conservatism, and the same non-legal-advice framing
// as lib/contract-clause-scan.js -- see that file's design note for the
// fuller reasoning (verbatim-quote validation, fail-closed on any parse
// error). This is structurally harder than clause scanning: exclusivity
// terms are free text with NO structured start/end date anywhere in the
// schema, so the model has to reason about plausible timeframes from
// prose alone (e.g. "90 days from launch," "through Q4") rather than
// comparing real date ranges. That makes false negatives more likely
// than clause-scan's -- this tool is a prompt to go re-read the actual
// contracts side by side, not a guarantee no conflict exists.
//
// IMPORTANT: this is NOT legal advice and does not represent a legal
// determination that a conflict exists or that either contract is
// breached. It flags language worth a human -- ideally a lawyer --
// looking at directly, exactly like contract-clause-scan.js. This
// framing must be preserved in any UI copy built on top of this.

const GROQ_MODEL = 'llama-3.3-70b-versatile';

async function checkExclusivityConflicts(newContract, otherContracts) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || !newContract) return null;

  const newTerms = (newContract.exclusivity_terms || '').trim();
  if (!newTerms) return { flagged: false, concerns: [], rationale: 'This contract has no exclusivity terms to check.', model: GROQ_MODEL };

  const candidates = (otherContracts || [])
    .filter(c => c.id !== newContract.id && (c.exclusivity_terms || '').trim())
    .slice(0, 15); // cap -- a creator with a very long signed history shouldn't blow the prompt budget on one scan

  if (!candidates.length) {
    return { flagged: false, concerns: [], rationale: 'No other signed contracts with exclusivity terms were found to check against.', model: GROQ_MODEL };
  }

  const otherContractsText = candidates.map((c, i) =>
    `[Other Contract ${i + 1} -- sponsor: ${c.sponsor_company_name || 'unknown'}, signed: ${c.created_at ? c.created_at.slice(0, 10) : 'unknown date'}]\nExclusivity terms: ${c.exclusivity_terms}`
  ).join('\n\n');

  const prompt = `You are helping an individual content creator avoid accidentally breaching an exclusivity clause across multiple sponsorship contracts. Read the NEW contract's exclusivity terms below, then check each OTHER already-signed contract's exclusivity terms for a plausible conflict.

A conflict means: the new contract's sponsor/category plausibly falls within a category, competitor restriction, or timeframe that an OTHER contract's exclusivity terms describe as off-limits -- e.g. an other contract says "exclusive to [category] for 90 days from [date]" and the new contract is with a company in that same category, signed within a timeframe that could still be inside that window.

Be conservative: only flag when the OTHER contract's exclusivity text plausibly restricts the category/competitor the NEW contract falls into. Do not invent a timeframe, category, or competitor relationship that isn't stated or strongly implied by the actual text. If the categories are unrelated, or the other contract's exclusivity window has clearly and unambiguously already ended based on the dates given, do not flag it.

NEW CONTRACT:
Sponsor: ${newContract.sponsor_company_name || 'unknown'}
Deliverables: ${newContract.deliverables || 'n/a'}
Exclusivity terms: ${newTerms}

OTHER ALREADY-SIGNED CONTRACTS TO CHECK AGAINST:
${otherContractsText}

Respond ONLY with JSON, no other text, in exactly this shape:
{"flagged": boolean, "concerns": string[], "rationale": string}

"concerns" must be the EXACT text (copied verbatim from one of the "Exclusivity terms" fields above, each entry under 300 characters) of every clause that triggered a flag -- must match the source text exactly, not a paraphrase. "rationale" is one to two sentences in plain, non-legal language explaining the plausible conflict and why, or "No plausible exclusivity conflict found against this creator's other signed contracts." if clean.`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      max_tokens: 700,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Exclusivity conflict check failed (${res.status})`);
  }

  const text = (data.choices?.[0]?.message?.content || '').trim();
  const cleaned = text.replace(/```json|```/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fail closed, same reasoning as contract-clause-scan.js -- a
    // malformed response should never silently produce a flag or,
    // worse, a false "all clear."
    return null;
  }

  const sourceText = otherContractsText;
  const concerns = Array.isArray(parsed.concerns)
    ? parsed.concerns.filter(c => typeof c === 'string' && sourceText.includes(c))
    : [];

  return {
    flagged: !!parsed.flagged && concerns.length > 0,
    concerns,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 700) : '',
    model: GROQ_MODEL,
    checkedAgainst: candidates.length,
  };
}

module.exports = { checkExclusivityConflicts };
