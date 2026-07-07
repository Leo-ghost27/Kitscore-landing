# Kitscore — Session Handoff (July 7, 2026 — v31)

**Context:** direct continuation of v30. Followed up on the "Kitscore Creator Value Review" one-pager (external doc, reviewed this session) — specifically the flagged scoring data-integrity gap. Ran the migration that had been written-but-not-run, then closed the next gap in the same finding (evidence approval not writing to score_components).

## 1. Professionalism score component — was written, now actually live

`supabase/2026-07-07-professionalism-score-component.sql` was pushed to `main` in a prior session but **never executed against the live DB** — confirmed via `pg_proc`/`pg_trigger` before touching anything. Ran it this session via `apply_migration` (tracked as `professionalism_score_component`):

- `fn_recalc_professionalism()` + `trg_recalc_professionalism` on `campaigns` are live.
- Backfill loop ran and correctly inserted 0 rows — there are currently zero campaigns with `endorsement_submitted_at` set, so there's nothing to backfill yet. Will populate automatically the next time an endorsement is submitted.
- Additive only, as designed — did not touch `compute_creator_reliability`, `reliability_score`, or any existing trigger.

**Correction to the external review doc:** it claims `confidence` has "no calculation logic anywhere in the codebase." That's stale — `fn_recalc_confidence()` shipped in `add_confidence_score_calculation` (2026-07-06), wired to triggers on both `score_components` and `campaigns`, and is computing real values today (e.g. creator `33333333…` = confidence 33). Worth correcting before that doc goes anywhere external.

Confirmed still accurate: `audience_authenticity`, `engagement_quality`, `content_consistency` had zero write paths anywhere in the codebase — grep'd every function in `public` schema, no matches. All existing rows for those keys were seed/demo data only (June 19 seed, `eve_h` July 6 demo seed).

## 2. Evidence approval → score_components — new this session

This was the next-priority item in the same flagged finding: `evidence_uploads` admin-approval was cosmetic, never wrote to `score_components`/`trust_score`.

Researched how the industry actually scores these dimensions (CreatorScore, Favikon, HypeAuditor) before building anything — real audience_authenticity/engagement_quality scoring is built from OAuth-pulled platform data through bot/authenticity detection, not manual evidence review. That's the Tier 2 "OAuth-verified analytics" item, not something to fake today.

Given that, built the honest interim version rather than inventing a fake-precise score:

- New migration `evidence_approval_writes_score_components`: `fn_recalc_evidence_component()` fires when an `evidence_uploads` row transitions to `status = 'live_verified'` (admin-approved).
- Maps `evidence_type` → component the way the product already names things: `Audience` → `audience_authenticity`, `Analytics` → `engagement_quality`, `Campaign` → `content_consistency`.
- Value is volume-tiered and capped: 1 approved item → 65, 2 → 80, 3+ → capped at 85. Never reaches the ~90-100 range real OAuth-verified data could earn — deliberate, mirrors the industry practice of capping scores built on unverified/incomplete data.
- Component status is written as `evidence_submitted`, never `live_verified` — so the dashboard can honestly label this as self-reported/admin-reviewed pending platform verification, not platform-verified. If a component is already `live_verified` from another source, this trigger won't downgrade it.
- Weight set to the same 0.20 placeholder as `professionalism` — flagged for the same weight-split review once all 5 components have real write paths.
- Backfilled existing approved evidence: one creator (`11111111…`) had a pre-existing `live_verified` Analytics upload → `engagement_quality` now shows 65 / `evidence_submitted`, correctly not clobbering other creators' seeded `live_verified` rows.

Additive only — did not touch `trust_score`'s formula, `compute_creator_reliability`, or the brand_safety/professionalism/confidence triggers.

## Not done this session

Everything from v30's "for next session" list is unchanged and carried forward — in particular, real click-through testing on Team/Clients as owner + member is now four sessions deep without live verification.

## For next session

Still, in priority order:

1. **Real click-through as owner + member test accounts** (carried from v28/29/30 — now the most overdue item).
2. **Weight-split decision**: once `audience_authenticity`/`engagement_quality`/`content_consistency` have any real write path (currently: evidence-approval only, capped at 85; OAuth pull not built), review the 5-way weight split together instead of each defaulting to 0.20.
3. **Dashboard copy**: surface the `evidence_submitted` vs `live_verified` distinction to creators (score breakdown panel — Tier 1 rec #1 from the creator value review — is the natural place for this).
4. Decide on 150/mo quota enforcement.
5. `notification_failures` table check.
6. Remaining Team-tier feature backlog: compliance-ready audit trail export, score-change alerts, API access, dedicated account contact.
