# Kitscore — Session Handoff (July 7, 2026 — v29)

**Context:** direct continuation of v28. v28 shipped the Clients tab (create clients, move through pipeline) but left a gap: nothing anywhere let a sponsor actually tag an evaluation with a client. This session closed that gap.

Latest commit on `main`: `0a41325`

## Connected evaluations to clients — shipped

**`evaluate.html`** — new Client card on the unlocked evaluation view, gated on `evalRow.team_id` (same gate the approval-workflow card already used). This isn't an arbitrary choice: `evaluations_team_approval` is the only RLS policy that grants a non-admin sponsor UPDATE on `evaluations` at all, and it requires `team_id IS NOT NULL`. A solo (non-team) sponsor has no UPDATE path on their own evaluation rows today — so gating client assignment on team context isn't just consistent with the rest of the Team feature set, it's the only place it could actually work. Dropdown is populated from `fn_team_clients(myTeamId)` and writes straight to `client_id` via that existing policy — no new RLS needed.

**`history.html`** — client filter dropdown (All / No client / each client), shown only for sponsors on a team with at least one client. Client name now shows inline on each row via an embedded `clients(name)` join (covered by the existing `clients_member_select` policy). Filtering happens client-side against the already-fetched list, so switching the filter doesn't hit the network again.

No schema changes this session — `client_id` and its policies were already live from v28.

## Verification

- Syntax-checked both files' inline scripts (`node --check`) before pushing.
- Did not click-through live (still no test credentials in this session) — same caveat as v28, now compounding across two sessions. This should be the first thing done next session before building anything further on top.

## Not done this session

- Delete-client UI — still open from v28.
- Quota enforcement decision — still open, unchanged.
- `notification_failures` check — still open from v26.
- Remaining Team-tier feature backlog (audit trail export, score-change alerts, API access, dedicated account contact) — untouched.

## For next session

1. **Do a real click-through as both an owner and a member test account** — Roster/Notes/Approvals/Branding/Clients tabs, adding a client, assigning an evaluation to it from evaluate.html, filtering history.html by client. Two sessions of schema+UI work have gone out without this.
2. Decide on 150/mo quota enforcement.
3. `notification_failures` table check.
4. Remaining Team-tier feature backlog.
