# Kitscore — Session Handoff (July 7, 2026 — v27)

**Context:** direct continuation of v26 (the outage). Gina applied the one-click fix (`DROP POLICY profiles_select_via_shared_team`) herself via the Supabase Policies GUI — confirmed dropped. This session audited the entire policy set for other recursion risk, hardened the one latent gap that remained, rebuilt the feature the outage fix had cost, and committed everything the outage handoff said should have been committed in the first place.

## Confirmed: the fix took, and there are no other cycles

Pulled every RLS policy in the schema (33 policies across 16 tables) and traced every raw cross-table reference by hand into a dependency graph. Result: a clean DAG — `profiles` and `campaigns` are terminal nodes with zero outgoing cross-table references, and every other table's raw subqueries flow toward one of those two, never back. No other circular dependency exists today.

One latent risk remained: all four `teams` policies (`_select`, `_insert`, `_update`, `_delete`) queried `profiles` directly via raw subquery instead of the `SECURITY DEFINER` `fn_current_profile_id()` helper every other cross-table policy uses for exactly this reason. It didn't cause the outage on its own (`profiles` no longer references `teams` after the drop), but it's the identical shape — if any future `profiles` policy ever references `teams` or `team_members` again, this reopens the same loop. Rewrote all four to use `fn_current_profile_id()`. Verified nothing broke: re-ran the owner's team access, membership count, and profile/sponsor visibility checks post-change, all correct.

## Rebuilt "see your teammate's name" — the safe way this time

Dropping `profiles_select_via_shared_team` fixed the outage but reopened the exact gap it existed to cover. Turned out this was already visible before the outage was diagnosed as an outage — **the "0 members" bug Gina reported was the same root cause**, just its first symptom: `team.html`'s member list used `profiles!inner(display_name)`, and an `!inner` join silently drops the whole row when the nested profile isn't RLS-visible. Once `profiles_select_via_shared_team` started misbehaving, the query either errored (defaulting the UI to an empty array) or dropped the non-owner row outright — same underlying gap, two different visible symptoms.

Rebuilt as three `SECURITY DEFINER` functions instead of a table-level policy, per the outage handoff's own recommendation:
- `fn_team_roster(team_id)` — member list with names, replaces the broken embed. **Verified**: now correctly returns both "GHG" (owner) and "Eve Co" (member) — the original bug is fixed.
- `fn_team_notes(team_id)` — same fragile `profiles!inner` shape existed here too (author name lookup), would have silently dropped any note from a non-owner teammate the first time one was posted. Fixed proactively before Gina hit it.
- `fn_team_pending_approvals(team_id)` — same shape a third time, in the owner's approval queue (requester name lookup). Fixed proactively too.

All three enforce access **inside the function body** (`fn_is_team_member` / owner check) rather than via a table-level RLS policy — this is what makes them structurally safe against recursion, not just convention. Verified: a non-member/non-owner test call to `fn_team_pending_approvals` correctly returns zero rows rather than erroring or leaking data.

`team.html` updated to call all three via `sb.rpc(...)` instead of the embedded-join queries.

## Everything committed to the repo this time

Per the outage handoff's process note — three RLS changes had gone straight to production with no file in the repo before this session (`team_invites_invitee_select` in v24, two fixes in v25, and `profiles_select_via_shared_team` itself, author/session unknown). `supabase/2026-07-07-recursion-fix-and-hardening.sql` now captures the full sequence: the outage fix, the `teams` hardening, and all three new functions, in the order they were actually applied. Pushed alongside the `team.html` update.

## Not done this session

- `notification_failures` check (signup email alerts) — still unconfirmed, carried over from v26
- Multi-client organization — scoped separately this session, not built yet (see below)

## For next session

1. Confirm recovery is holding: sponsor Directory/Campaigns/Watchlist, creator Campaigns, team-plan account access — should already be fine post-fix, but v26 didn't get to formally re-confirm across all four before ending
2. `notification_failures` table check
3. Multi-client organization build (scoped this session)
