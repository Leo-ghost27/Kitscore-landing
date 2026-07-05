# Kitscore — Session Handoff (July 5, 2026 — v21)

Latest commit on `main`: `76f5ef8`

**Heads up for next session:** at least two sessions have been working on this repo in parallel again this window (same pattern as before — same bug independently found and fixed twice, once by each side). Always `git fetch origin main` and check for new commits before starting code work, and expect to merge, not just push.

## Shipped this session

**Founding Creator badge redesigned** — replaced the icon-font text pill (dashboard, profile, directory) with an inline SVG gold seal (layered circles + white star). No external font dependency, so it can't fail to render the way it did in the screenshot that prompted this (the old version used an icon font that hadn't loaded).

**Trust-score ring overlap bug — fixed twice, second time for real.** First pass (mine, this session) used flex-column with adjusted spacing. A parallel session found that still overlapped live despite passing a local check, and rewrote it with explicit absolute positioning + transform offsets instead — more robust, since it doesn't depend on flex behaving a specific way. Kept their version in the merge. **Lesson for both sessions: a CSS fix that looks correct on paper isn't verified until it's actually seen rendering correctly** — static analysis of CSS caught the "should work" case but missed that it still didn't, twice.

**Real product screenshots added to the landing page.** New "See It In Action" section (after Sample Reports) using actual screenshots you provided — the sponsor directory and a full evaluation report — not mockups. Framed in a simple browser-chrome style matching the site. Images live in a new `assets/` folder.

**Audience geo/demographic data — the "direction agreed, not built" item from the original 2026-07-02 doc, now fully built.** Self-reported, matching the brand-safety questionnaire pattern exactly, per the originally agreed direction:
- New `audience_demographics` table (top country + %, dominant age range, gender split), owner-only RLS, single row per creator.
- New form on the creator dashboard, right after the brand safety questionnaire.
- Wired into both PDFs. The sponsor decision memo's rendering code for this was **already sitting in the file from an earlier commit**, written in anticipation of this data existing — it only needed the actual data fetch, which was the missing piece. The creator's own proof packet needed both the fetch and the rendering; both done.
- Both PDFs clearly label it "self-reported by the creator, not verified against platform analytics" — same trust distinction as `evidence_status` (self_reported vs live_verified) elsewhere in the product.

**Real root-cause finding while building the above:** discovered this Supabase project has a standing `ALTER DEFAULT PRIVILEGES` rule (under the `postgres` role) that auto-grants full table access to `anon`/`authenticated` on **every newly created table**, before any RLS is even written. This isn't just history — it fired on `audience_demographics` the moment it was created, live, this session. This is the actual mechanism behind every leak found in the last several sessions (`creators`, `profiles`, `sponsors`, `team_invites`, `campaigns`). **Revoked the default going forward** — new tables should no longer inherit this automatically. Worth explicitly re-checking grants on any table created from now on anyway, rather than assuming the fix is bulletproof forever.

## Needs your action

Unchanged from v20:
1. Stripe live Price ID cross-check — still the one nobody has done.
2. Leaked password protection — you've said no, cost not worth it right now, that's settled, not re-flagging further.
3. YouTube → footer — on hold while you build up content, as planned.
4. Anthropic billing — your call, not time-pressured.
5. RLS performance — 4 tables deliberately deferred (`evaluations`, `score_components`, `sponsors`, `team_members`), low value at current scale.

## Open — unchanged / new

- ~~Audience geo/demographic data~~ — done.
- Sponsor endorsement flow — still not integration-tested against a real live login.
- XP/gamification system — discussed, design feedback given, not built.
- Consider adding the audience-demographics display to `evaluate.html` too (the sponsor's on-screen view before generating a PDF) — not built, since the two PDFs (the actual paid deliverables) already cover it fully. Easy follow-up if you want on-screen parity.
