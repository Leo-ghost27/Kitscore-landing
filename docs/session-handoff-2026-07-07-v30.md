# Kitscore — Session Handoff (July 7, 2026 — v30)

**Context:** direct continuation of v29. Small, contained pass: wired up the one piece of the Clients feature that was scoped but deliberately left out in v28 — deleting a client.

Latest commit on `main`: `10f5c4b`

## Delete-client UI — shipped

`clients_owner_delete` RLS has existed since the very first Clients migration (v28) but nothing in the UI called it. Added:
- A small `×` button on each pipeline card in `team.html`, rendered **only** when `myRole === 'owner'` — matches the RLS policy exactly (`teams.owner_id = fn_current_profile_id()`), so the UI-level gate and the DB-level gate agree instead of one silently failing behind the other.
- A `confirm()` dialog before deleting, worded from the actual schema rather than an assumption: checked `pg_constraint` and confirmed `evaluations.client_id` is `ON DELETE SET NULL`, so the dialog correctly tells the owner evaluations get unassigned, not deleted.

No schema changes, no new RLS — this only exposes what already existed.

## Not done this session

Everything else from v29's list is unchanged and carried forward as-is.

## For next session

Still, in priority order:

1. **Real click-through as owner + member test accounts.** Now three sessions deep (v28, v29, v30) of schema+UI work on Team/Clients without live verification — this is the thing most worth doing before building further on top, not after.
2. Decide on 150/mo quota enforcement.
3. `notification_failures` table check.
4. Remaining Team-tier feature backlog: compliance-ready audit trail export, score-change alerts, API access, dedicated account contact.
