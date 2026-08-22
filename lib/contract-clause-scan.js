// Scans a contract's actual terms (deliverables, compensation, usage
// rights, exclusivity, additional terms) for three categories of red flag:
//
//   1. Indemnification/liability language that shifts third-party legal
//      exposure onto the creator disproportionately -- e.g. the creator
//      agrees to indemnify the sponsor against claims arising from the
//      sponsor's own product, or is made liable for a compliance failure
//      (like a missing FTC disclosure) that the sponsor's own brief or
//      approval process contributed to.
//
//   2. "Fake ambassador program" compensation patterns -- deliverables
//      that read like a real paid sponsorship (a content calendar,
//      exclusivity, usage rights, posting cadence) but compensation is
//      limited to a discount code, affiliate commission, or free product
//      only, with no flat fee or guaranteed payment. Creators report
//      brands running the "collaboration discussion" as if it were a
//      paid deal, then the actual terms turn out to be "post about us
//      for a 10% discount code" with no real pay. This is a scope/
//      compensation mismatch flag, not a claim that gifting or affiliate
//      deals are illegitimate -- plenty are fine when clearly proposed as
//      such from the start.
//
//   3. Usage-rights scope mismatch -- a grant that is perpetual (no end
//      date) and/or worldwide (no territory limit) and/or extends to
//      paid advertising (the sponsor may run the creator's content as an
//      ad, not just post it organically), where the rest of the contract
//      gives no indication the creator was told about or separately
//      compensated for that scope. This is not a claim that broad usage
//      grants are inherently unfair -- a paid, clearly-scoped perpetual
//      worldwide ad-usage buyout is a normal, legitimate deal. The flag
//      is for when that scope is buried in boilerplate the creator likely
//      wouldn't parse as "this brand can run my face in ads forever,
//      everywhere" -- the same "would a non-lawyer actually understand
//      what they agreed to" test as Category A, applied to usage scope
//      instead of liability.
//
// Same shape and same conservatism as lib/disclosure-scan.js -- see that
// file for the fuller design note on why this pattern (verbatim-quote
// validation against the actual input, fail-closed on any parse error,
// explicit non-legal-advice framing) is used throughout this codebase.
//
// IMPORTANT: this is NOT legal advice and does not represent a legal
// determination of enforceability, reasonableness, or actual risk under
// any jurisdiction. It flags language patterns worth a human -- ideally
// a lawyer -- looking at directly. It never asserts a clause IS
// dangerous/a scam, only that it reads as one-sided or mismatched and
// may be worth review. This framing must be preserved in any UI copy
// built on top of this.

const GROQ_MODEL = 'llama-3.3-70b-versatile';

async function scanContractClauses(contract) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || !contract) return null;

  const sections = [
    ['Deliverables', contract.deliverables],
    ['Compensation', contract.compensation],
    ['Usage rights', contract.usage_rights],
    ['Exclusivity terms', contract.exclusivity_terms],
    ['Additional terms', contract.additional_terms],
  ].filter(([, text]) => text && text.trim());

  if (!sections.length) return null;

  const contractText = sections.map(([label, text]) => `[${label}]\n${text}`).join('\n\n');

  const prompt = `You are helping an individual content creator understand a sponsorship contract's terms before they sign. Read the contract text below and identify any language matching any of the categories below:

CATEGORY A -- one-sided liability:
1. The creator agrees to indemnify, hold harmless, or bear liability for the sponsor (or a third party) for claims that could reasonably arise from the SPONSOR's own product, service, claims, or compliance failures -- not just the creator's own conduct.
2. The creator is made solely responsible for regulatory/disclosure compliance (e.g. FTC disclosure) with no corresponding sponsor obligation to provide compliant creative direction or review.
3. Indemnification obligations run one-way (creator indemnifies sponsor) with no reciprocal protection for the creator.
4. Liability, indemnification, or compliance obligations are vague or open-ended enough that a reasonable non-lawyer creator likely wouldn't understand the scope of what they're agreeing to.

CATEGORY B -- fake ambassador / no real pay:
5. Deliverables describe a real sponsorship workload (a content calendar, multiple posts, exclusivity, broad usage rights, a posting cadence) but Compensation contains no flat fee or guaranteed cash payment -- only a discount code, affiliate/commission link, or free product. Scope of ask and form of pay are mismatched.
6. Compensation is phrased ambiguously enough that a creator could reasonably read it as paid work, when what's actually offered is gifting/affiliate-only (e.g. "compensation: promotional partnership" or similar vague language, with no dollar figure or rate anywhere in the contract).

CATEGORY C -- usage-rights scope beyond what the contract otherwise indicates the creator understood or was paid for:
7. Usage rights are perpetual / have no stated end date or duration, AND nothing elsewhere in the contract (Compensation, Additional terms) suggests the creator was told about or paid extra for a perpetual grant.
8. Usage rights are worldwide / have no stated territory limit, with the same "no indication this was disclosed or compensated" test as above.
9. Usage rights explicitly extend to paid advertising, boosted posts, or media buying (the sponsor may run the creator's content as a paid ad, not just repost it organically) with no separate ad-usage fee or buyout amount mentioned anywhere in the contract.
10. Usage rights language is broad and open-ended enough ("any and all media, in perpetuity, throughout the universe," or similar) that a reasonable non-lawyer creator likely wouldn't grasp what they were granting.

Do NOT flag: standard mutual indemnification, ordinary usage-rights or exclusivity terms, payment terms or deliverable specifications with no liability-shifting language (Category A); clearly-disclosed gifting/affiliate-only arrangements where the compensation section is explicit and unambiguous about there being no flat fee (Category B); or a perpetual/worldwide/paid-ad usage grant where the contract itself shows it was a clear, compensated buyout (Category C) -- flag only when the mismatch or lack of disclosure itself is the issue, not broad usage grants in general. Be conservative -- only flag language that actually appears in the text below, and only if it plausibly fits one of the patterns above. If the contract has none of this language at all, that is not itself a flag.

Respond ONLY with JSON, no other text, in exactly this shape:
{"flagged": boolean, "concerns": string[], "rationale": string}

"concerns" must be the EXACT text (copied verbatim from the contract text below, each entry under 300 characters) of every clause or phrase that triggered a flag, or empty if none did -- this must match text from the contract exactly, not a paraphrase or summary. "rationale" is one to two sentences in plain, non-legal language explaining what's concerning and why, written for someone with no legal background, or "No one-sided liability language, pay/scope mismatch, or undisclosed usage-rights scope found." if clean.

Contract text:
${contractText}`;

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
    throw new Error(data?.error?.message || `Contract clause scan failed (${res.status})`);
  }

  const text = (data.choices?.[0]?.message?.content || '').trim();
  const cleaned = text.replace(/```json|```/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fail closed -- a malformed response should never silently produce
    // a flag or, worse, a false "all clear."
    return null;
  }

  // Validate every quoted concern actually appears somewhere in the
  // source text rather than trusting the model's output verbatim --
  // mirrors disclosure-scan.js's and brand-safety-scan.js's same check.
  const concerns = Array.isArray(parsed.concerns)
    ? parsed.concerns.filter(c => typeof c === 'string' && contractText.includes(c))
    : [];

  return {
    flagged: !!parsed.flagged && concerns.length > 0,
    concerns,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 700) : '',
    model: GROQ_MODEL,
  };
}

module.exports = { scanContractClauses };
