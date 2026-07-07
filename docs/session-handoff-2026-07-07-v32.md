# Kitscore — Session Handoff (July 7, 2026 — v32)

**Context:** direct continuation of v31. Gina shared a 2-image mockup ("Fiona R" dashboard concept + verification chain of custody) and asked which parts mesh with what's already built. Reviewed against the live codebase, shipped the genuine quick wins, flagged the rest as real scoping work — held off on OAuth scoping per her instruction, added a note to the external one-pager doc instead.

Latest commit on `main`: `97f89c1` (code), `9b64896`/`557c9f0` from v31 session.

## Mockup review — what meshed, what didn't

**Quick wins shipped this session:**

1. **"Why is my score X?" link.** The score breakdown panel it points to already existed in `dashboard.html`, already wired to `live_verified`/`evidence_submitted` status. This was a link, not a build — added `#score-breakdown` anchor + a small link next to the trust score ring.
2. **"What should I charge?" rate calculator.** Pure frontend — no schema dependency, `creators` has no `followers` column so it's a standalone tool. Formula: min = followers × 0.005, max = followers × 0.01 (matches the mockup's 18,000 followers → £90–£180 exactly). Added as its own card above the brand safety questionnaire.
3. **Verification chain of custody.** `evidence_uploads` already had `status` + `uploaded_at`; only real gap was a review timestamp. Added one additive column (`reviewed_at`) with a `BEFORE UPDATE` trigger (`fn_set_evidence_reviewed_at`) that sets it automatically whenever status moves to `live_verified` or `rejected`, regardless of which code path does the update. Built an expandable per-evidence-item timeline in `evidence.html` (`renderChainOfCustody`/`toggleChain`) with three steps: upload (self-reported), review (live/pending/rejected, using the new timestamp), and a static "OAuth-verified analytics not connected" step — no link, since there's no OAuth connect flow to point to yet.

**Flagged as real builds, not quick wins — did not build:**

- **Score history graph.** No history table exists at all today. Needs a new table, a snapshot trigger (piggyback on the existing `trust_score` recalc trigger), and a chart.
- **Shareable trust profile link.** Correcting the original review doc: this doesn't exist today, not even Pro-gated — there's no slug column, no public unauthenticated route. Real build.
- **"Invite a past sponsor to confirm" CTA.** No creator-initiated sponsor invite mechanism exists. The team-invite token/email pattern (`api/invite-team-member.js`) is reusable, but this still needs net-new schema for campaign-level invites.
- **Disclosure compliance check.** No infra exists — genuine new capability (scanning posts for #ad/sponsorship disclosure). Biggest lift of the set.

## One-pager doc

Added a "Session addendum" section to `Kitscore_Creator_Value_Review.docx` (the file Gina uploaded) covering: the flagged-finding backend fixes from earlier in the day, the two stale claims corrected (confidence calc logic, score-breakdown UI already existing), the OAuth-scoping hold, and this mockup mesh/no-mesh breakdown. Delivered back to Gina as a file, not pushed anywhere — it's an external doc, not part of the repo.

## Verification

Syntax-checked both modified files (`dashboard.html`, `evidence.html`) by extracting and parsing the inline `<script>` blocks with Node before committing — both clean.

## Not done this session

Everything from v31's "for next session" list is unchanged and carried forward, plus the four real-build items above are now explicitly scoped-but-not-started rather than just implied by the mockup.

## For next session

Still, in priority order:

1. **Real click-through as owner + member test accounts** — now five sessions overdue (v28–v32).
2. **Weight-split decision** — same as v31, now slightly more urgent since evidence-approval is live and actually populating components.
3. Pick one of the four "real build" items above to scope next. Score history is probably the cheapest of the four (reuses the existing trust_score trigger pattern) if going by effort; disclosure compliance is the most differentiated if going by the original review's strategic ranking.
4. Decide on 150/mo quota enforcement.
5. `notification_failures` table check.
6. Remaining Team-tier feature backlog: compliance-ready audit trail export, score-change alerts, API access, dedicated account contact.
