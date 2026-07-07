# Kitscore — Session Handoff (July 7, 2026 — v25)

**Context:** direct continuation of v24, same day. Gina tested the invite-visibility fix live (screenshots: banner appeared correctly, but clicking "Accept invite" failed with a Postgres RLS error). This session root-caused and fixed two real, pre-existing bugs surfaced by that test — no new features, pure bug fixing, DB-only (no client code changes required).

## Bug 1: `team_invites_accept_update` had no explicit `WITH CHECK`

This policy predates this session (part of the original invite scaffolding). Its `USING` clause required `accepted_at IS NULL`. With no `WITH CHECK` specified, Postgres defaults to reusing `USING` for both — meaning the policy required the **post-update** row to *still* have `accepted_at IS NULL`. But the entire point of the UPDATE is to set `accepted_at`. The policy was mathematically guaranteed to fail on every real accept, always. This was never exercised end-to-end before now, which is how it survived this long.

**Fix:** explicit `WITH CHECK` that only requires the email match, not `accepted_at IS NULL`.

## Bug 2: the resulting row also has to stay SELECT-visible — a second, deeper version of the same shape

Fixing bug 1 wasn't enough — the UPDATE still failed. Root cause, confirmed via `EXPLAIN` and direct reproduction: Postgres requires an UPDATE's resulting row to remain visible under the table's **SELECT** policies too, not just satisfy the UPDATE policy's own `WITH CHECK`. `team_invites_invitee_select` (added last session) required `accepted_at IS NULL`; `team_invites_member_select` requires already being a team member. The instant `accepted_at` gets set, *neither* policy covers that row for the person who just accepted it — they're mid-transaction between "invited" and "member," visible to no SELECT policy at all. Same chicken-and-egg shape as last session's invite-visibility bug, one layer deeper.

**Fix:** relaxed `team_invites_invitee_select` to just "this invite is addressed to my email," dropping the `accepted_at`/expiry condition. It's their own invite regardless of its state — no security cost to letting them see it after accepting.

## Bug 3 (same root cause family): `team_members` self-join INSERT failed via `upsert(...).onConflict()`, not via plain INSERT

Reproduced directly: the identical `INSERT` statement succeeds on its own, but fails under RLS the moment `ON CONFLICT (team_id, sponsor_id) DO NOTHING` is added (which is what the client's `.upsert(..., {ignoreDuplicates: true})` call generates). Postgres's conflict-detection path needs a SELECT-visible route to a potential existing row for the inserting user — and an invited member, not yet a team member, had no SELECT policy covering their own `team_members` rows at all.

**Fix:** added `team_members_self_select` — lets someone see their own membership rows (`sponsor_id = fn_current_profile_id()`), independent of which team. Low-risk, narrowly scoped to their own rows.

## Verified end-to-end before reporting fixed

Rather than reasoning it through and hoping, the full three-statement flow (`team_invites` accept → `team_members` insert → `sponsors` plan update) was replayed inside a transaction, impersonating `akhenaton.djina@gmail.com`'s real session (same technique used to originally diagnose it — `SET LOCAL ROLE authenticated` + her real `auth.uid()`), then rolled back so her actual pending invite is untouched and ready for a real test. All three steps succeeded. The `sponsors.plan` update line was independently confirmed against the actual `accept-invite.html` source rather than assumed.

## Not yet done

- Gina needs to retest for real: log into "Eve Co" (`akhenaton.djina@gmail.com`), check the Team page banner still shows, click "Accept invite," confirm it now completes instead of erroring.
- The rest of the v23/v24 end-to-end checklist (member unlock → 403 → owner queue → approve → checkout) is still unexercised against a live two-person team.
- Multi-client organization — still the only unbuilt Team-tier feature from the v22 priority list.

## Process note worth keeping in mind next time

This is the second round of "looked correct on paper, failed live" for the same invite feature (v24's fix, then this session's two deeper layers of the same problem). Postgres RLS interactions between an UPDATE/INSERT's own policy and the table's SELECT policies are genuinely non-obvious — reasoning through the SQL text isn't sufficient to catch them. Going forward, worth impersonating the actual test account via `SET LOCAL ROLE authenticated` + `request.jwt.claim.sub` and replaying the exact statement (including `ON CONFLICT` clauses, which turned out to matter) before reporting an RLS fix as done.
