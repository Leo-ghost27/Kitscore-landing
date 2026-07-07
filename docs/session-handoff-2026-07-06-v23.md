# Kitscore — Session Handoff (July 6, 2026 — v23)

**Context:** picks up directly from v22's Team-tier feature audit (1 of 9 advertised features real). This session built the first two: roles/permissions enforcement and an internal approval workflow. White-labeling and multi-client organization are next.

## What this session found before building anything

Before touching code, read the actual schema and `evaluate.html` rather than working only from the v22 doc, and found **an existing, unfinished approval workflow neither the doc nor the prior planning conversation knew about**:

- `evaluations` already had `team_id`, `approval_status`, `approval_note` columns, RLS policies referencing them, and a full draft → pending_approval → approved/rejected UI already built in `evaluate.html`.
- It was **dead code**: nothing in the codebase (`generate-evaluation.js`) ever wrote a value to `evaluations.team_id`, so the entire UI block (wrapped in `${evalRow.team_id ? ... : ''}`) never rendered for any team, ever.
- Even if it had rendered, the RLS policy (`evaluations_team_approval`) let **any** team member move status to approved/rejected — no owner check. Same "column exists, nothing enforces it" shape the v22 audit already flagged for roles generally.

Decision made with Gina: finish wiring the existing scaffolding (cheap, most of the UI was already there) rather than build a parallel system, and keep a second, separate approval concept for spend-gating that doesn't overlap with it.

## What was built this session

**1. Fixed a live bug in the invite path (found while reading the roles code, fixed in the same pass per Gina's call):**
- `team_members` had exactly two RLS policies — owner-manage and member-select. No policy let an invited member insert their own row. `accept-invite.html`'s client-side `team_members` upsert (as the joining user, not the owner) should have been rejected by Postgres.
- Added `team_members_self_join` INSERT policy: an invited email with a live, unexpired invite can insert themselves as `role = 'member'` (never `'owner'` — that's hardcoded in the policy, not just the client).

**2. Spend-approval workflow (new — gates the $29 unlock action):**
- New table `approval_requests` (team_id, requested_by, action_type, target_type, target_id, note, status, reviewed_by, reviewed_at) with RLS: member can create for their own team, owner (or admin) can move it out of `pending`.
- New endpoints: `api/request-approval.js` (member files a request; re-uses an existing pending one instead of stacking dupes), `api/review-approval.js` (owner approves/rejects; double-checked against RLS as a second layer, not just the endpoint's own ownership check).
- `create-checkout-session.js`: for `evaluation_unlock`, if the buyer is a team `member` (not `owner`), the checkout session is blocked (`403`, `requiresApproval: true`) unless there's an `approved` request on file for that exact evaluation. Owners are unrestricted.
- `evaluate.html`'s `unlock()`: on a `requiresApproval` response, automatically files the request instead of just erroring, and tells the member it's gone to their owner.
- `team.html`: owner sees a **Pending approvals** queue (approve/reject inline); member sees a **Your requests** history with status badges.

**3. Fixed the dead internal-review workflow (existing scaffolding, now actually wired):**
- `generate-evaluation.js` now looks up the buyer's `team_members` row and sets `evaluations.team_id` (and `approval_status: 'draft'`) when they're on a team. This is the one-line reason the whole review UI was inert — now it activates.
- New trigger `fn_validate_evaluation_approval` (BEFORE UPDATE on `evaluations`): any team member can submit for review (`draft` → `pending_approval`), but only the team owner (or platform admin) can decide (`pending_approval` → `approved`/`rejected`). Closes the "any member could approve their own submission" gap.
- `evaluate.html`: Approve/Reject buttons now only render for the owner (`isTeamOwner` check using the member's `team_members.role`); non-owners see "Waiting on your team owner." Client-side guard also added in `reviewEvaluation()` as defense in depth — the trigger is the real enforcement.

## ⚠️ Action required before any of this is live

**Run `supabase/2026-07-06-team-roles-and-approvals.sql` in the Supabase SQL editor against project `tpcriphrfrrgywycviqv`.** It's additive and safe to run once, but nothing above works until it's applied — I don't have direct DB execution access from this environment, only the repo.

Committed and pushed to `main` directly as `d6293fc` (7 files changed). PAT used this session should be revoked now if it hasn't been.

## Not yet tested end-to-end

None of this has been exercised against a live Supabase instance or a real two-person team (owner + member) yet — it's been reviewed against the schema and RLS logic, not run. Recommend before trusting it in front of a real user:
- Create a second team member account, confirm the invite actually seats them now (the bug this session's fix addresses)
- As the member: generate an evaluation, confirm it comes back with `approval_status: 'draft'` and a `team_id`
- As the member: try to unlock an evaluation without approval — confirm the 403 and that a request appears in the owner's queue
- As the owner: approve it, confirm the member can then complete checkout
- As the member: try to approve/reject a submission directly (e.g. via browser console) — confirm the trigger blocks it, not just the UI

## Left for next session (from v22, still open)

- **Multi-client organization** — scoped as its own session per Gina's call, not touched this session. Likely the stronger "why Team" story per the v22 audit: client workspaces/tagging, a pipeline/status view (Prospecting → Under Review → Approved → Active), a usage dashboard against the shared 150/mo quota.
- **White-labeled reports** — third priority feature from the v22 order (roles/approval → white-labeling → multi-client, roles/approval now done). Reuses the existing PDF pipeline per the v22 recommendation.
- **Per-creator team notes fix** — `team_notes.creator_id` column exists but the UI never uses it (notes are generic team-wide, not scoped to a creator profile as advertised). Cheap, not done this session — got folded into the bigger roles/approval work instead.
- **Marketing page (remove/keep)** — Gina chose to hold copy changes until features actually ship, not do them in parallel. Still needs doing once white-labeling/multi-client land, or partially now that roles/approval are real: Roles & permissions and the internal approval workflow could arguably move from "Shipping soon" to "Included now" on the Team upsell page, now that they're real — worth Gina's call before editing that copy.
- Everything else unchanged from v22's open list: API access reconsideration (Enterprise tier, not Team), 24hr-turnaround claim removal, Stripe live Price ID full pass, confidence formula weighting revisit, grant-audit across `information_schema.role_table_grants`, founding creators + PDF unlock fee question.
