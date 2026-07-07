# Kitscore — Session Handoff (July 7, 2026 — v26)

**Status: production is currently down for creators and sponsors, team-plan and non-team alike. Root cause found and a specific fix identified. The fix was NOT applied — session ended before it was.**

## What's broken

`Could not load: infinite recursion detected in policy for relation "profiles"` (also surfaces as `"team_members"` depending on which table Postgres re-enters first — same underlying loop, not two bugs). Confirmed affecting:
- Creator directory, Campaigns, Watchlist for a plain sponsor account
- Campaigns for a creator account (Fiona R) with no team involvement at all — confirms this isn't team-scoped, it's hitting any query that touches a `profiles` row through certain join paths
- Team-plan sponsor accounts (`gina.hamza@aol.com`) reported unable to access paid features — very likely the same incident, not separate, though not independently confirmed this session

## Root cause — a genuine three-way circular RLS policy

Diagnosed by walking through Supabase's Policies GUI screen-by-screen (no SQL run, no DB access from this session — Gina navigated, I read what she sent). The cycle:

1. **`profiles_select_via_shared_team`** (on `profiles`) — queries `team_members` directly to let teammates see each other's profile
2. → **`team_members_owner_manage`** (on `team_members`, `FOR ALL` so it covers `SELECT` too) — queries `teams` directly to check ownership
3. → **`teams_select`** (on `teams`) — queries `profiles` directly to resolve the current user's id
4. → back to step 1, forever

**Critical detail:** `profiles_select_via_shared_team` is new and was applied directly to production — it does not exist anywhere in the repo, no migration file, nothing committed. This is the second time this exact pattern has caused a problem (see v24/v25 for the first: `team_invites_invitee_select`, also applied directly to prod with no file). Steps 2 and 3 (`team_members_owner_manage`, `teams_select`) are old, predate this session, and were harmless in isolation — they only became dangerous once step 1 connected all three into a loop.

## The fix — identified, not applied

**`DROP POLICY profiles_select_via_shared_team ON public.profiles;`**

This alone breaks the cycle at its newest, most avoidable link. The other two policies in the loop are pre-existing and don't need to change for the site to come back up. The only user-facing loss from dropping it is the "see your teammate's display name" convenience on the Team page — cosmetic, not blocking — until it's rebuilt correctly (see below).

**This was not run.** Gina was offered two ways to apply it — clicking "Delete policy" in the Supabase Policies GUI (already open, already navigated to, zero SQL typing), or a narrow one-click tool built via her connected Supabase account with code shown before anything executes. She wasn't comfortable with either in the moment and asked to end the session instead. **First action of the next session: get this policy dropped, by whichever of those two paths (or another) Gina's comfortable with.**

## Also found, not urgent, don't touch yet

All four policies on `teams` (`_select`, `_insert`, `_update`, `_delete`) query `profiles` directly via a raw subquery, instead of going through `fn_current_profile_id()` — the `SECURITY DEFINER` helper function that exists specifically so one table's policy can safely reference another without risking exactly this kind of loop. It's how every *other* policy in this schema does the same job safely. These four didn't cause today's incident on their own, but they're the same latent shape — worth hardening once the site is stable and not put off indefinitely, since this is now the second recursion incident from the same root pattern (an RLS policy written as a raw cross-table subquery instead of a `SECURITY DEFINER` helper).

## Process note — this keeps happening the same way

Third occurrence now of an RLS change going straight to production with no corresponding file in the repo: `team_invites_invitee_select` (v24), the two invite-acceptance fixes (v25), and now `profiles_select_via_shared_team` (author/session unknown — wasn't disclosed or found in any handoff doc before this one). Each time, whoever's debugging next has to reconstruct the live policy state by hand rather than reading it in the repo. Worth a hard rule going forward: **any RLS change, however small, gets written to a `.sql` file and committed — even a single `CREATE POLICY` or `DROP POLICY` line — before or immediately after it's applied.** This session's own diagnosis would have taken minutes instead of the better part of an hour if that rule had already been in place.

## Not done this session (unrelated to the outage, still open from v25)

- Multi-client organization — still untouched, still the top open Team-tier item
- `notification_failures` table check (signup email alerts reportedly not working) — asked, not yet confirmed either way before the session ended
- Everything else unchanged from v22–v25's open list

## For the next session, in order

1. Get `profiles_select_via_shared_team` dropped — top priority, site is down until this happens
2. Confirm recovery: sponsor Directory/Campaigns/Watchlist, creator Campaigns (Fiona R), team-plan account access
3. Check `notification_failures` for the signup-email issue
4. Once stable: rebuild "see your teammate's name" the safe way (a `SECURITY DEFINER` function, not a raw cross-table policy), and consider hardening the four `teams` policies flagged above
5. Multi-client organization, when there's room for it
