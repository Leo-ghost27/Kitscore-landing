# Kitscore — Session Handoff (July 4, 2026 — v20)

Latest commit on `main`: `1c02c29` + this session's commit once pushed (database-only work, one new migration file + this doc).

**Context:** picked up from a v19 doc (from a different, more advanced parallel session) that reported the two remaining "low priority" items closed and asked me to tackle "4. RLS policy performance cleanup." Spot-checked several of v19's claims before building on them (creator count, `pg_net` schema location) — both checked out accurately. Did not re-verify every claim in that doc line by line, but nothing found here contradicts it.

## Closed this session

**RLS policy performance cleanup — partially done, the safe/high-value part.** Supabase's performance advisor flags two categories of issue; fixed both where it could be done as a pure refactor with zero behavior change, verified via `SET ROLE` before and after:

1. **`auth_rls_initplan` (11 policies)** — direct `auth.uid()`/`auth.role()` calls in RLS policies get re-evaluated per row instead of once per query. Wrapped all 11 in scalar subqueries (`auth.uid()` → `(select auth.uid())`). Zero logical change, mechanical fix. **Fully resolved** — advisor now shows none of these.

2. **`multiple_permissive_policies` (across 7 tables)** — pairs of permissive policies on the same table+action get evaluated separately instead of merged, wasting cycles. Merged the three that were safe to merge directly:
   - `profiles`: two SELECT policies → one
   - `creators`: fixed by scoping `creators_select_authenticated` explicitly `TO authenticated` (it had no role restriction, so anon was uselessly evaluating it too, even though `auth.role()='authenticated'` is always false for anon)
   - `campaigns`: two SELECT policies → one

   **Deliberately deferred:** `evaluations`, `score_components`, `sponsors`, `team_members`. Each of these overlaps involves a `FOR ALL` policy that would need splitting into separate per-command policies to merge safely without risking a subtle change to INSERT/UPDATE/DELETE behavior. Given current data volume (dozens of rows per table, not thousands), the performance benefit is currently unmeasurable — didn't want to take on that risk for zero practical gain right now. Still shows WARN in the advisor; worth a dedicated session if data volume ever makes it matter.

**Important, honest caveat:** everything above was verified for *read visibility* (row counts match before/after, for both `anon` and simulated `authenticated` sessions). I did not run a full write-path regression test (every INSERT/UPDATE/DELETE across every affected table) — the policies I touched were either SELECT-only or, for the ones I edited more than just the auth-wrap (profiles, teams), I preserved the exact same USING/WITH CHECK logic, just reformatted. Low risk, but flagging the limit of what "verified" means here.

**Migration file added**: `supabase/2026-07-04-rls-performance-cleanup.sql`, per the practice established last session (v15) after the git/production drift investigation.

## Needs your action

Unchanged from v19:
1. Stripe live Price ID cross-check — still the main outstanding item, nobody has done it.
2. ~~Site copy fix (false 500+/89% stat)~~ — **already done, verified just now.** Checked `index.html` directly: the hero already shows "100% Evidence-Backed" / "AI-Powered Trust Scoring", no trace of the old false stat anywhere. This was fixed several sessions ago (commit `228ffb0`) but keeps getting carried forward as open in later handoff docs, including v19 — worth relaying that back if that session is still active, same lesson as `887d6a4` not actually existing.
3. Anthropic billing — on hold, your call.
4. Leaked password protection toggle — Supabase Auth settings, one click.
5. RLS performance — the 4 deferred tables above, if/when it matters.

## Open — unchanged

- Audience geo/demographic data — direction agreed, not built.
- YouTube channel → footer — hold until ~8-10 videos up.
- XP/gamification system — discussed, design feedback given, not built.
- Sponsor endorsement flow — still not integration-tested against a real live login.
