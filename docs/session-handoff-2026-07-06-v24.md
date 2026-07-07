# Kitscore — Session Handoff (July 6, 2026 — v24)

**Context:** picks up directly from v23 (roles/permissions enforcement + internal approval workflow, migration `2026-07-06-team-roles-and-approvals.sql` applied against `tpcriphrfrrgywycviqv`). This session fixed a real gap found while QA-testing v23's invite flow, corrected an inaccurate marketing claim, and started white-labeled reports (the next feature in the v22 priority order).

## Bug found and fixed: invited members had no way to see or accept an invite

Testing v23's fix (which let an invited member's `team_members` upsert succeed) surfaced a second, separate gap: **there was no way for the invited person to discover the invite existed at all**, short of being handed the raw token link by hand (email/Slack).

Root cause: `team_invites` only had a SELECT policy scoped to people who are *already* team members (`fn_is_team_member(team_id)`). An invited person isn't a member yet, so they couldn't query their own pending invite row — a chicken-and-egg gap in the RLS, not a UI bug.

Fixed both ends:
- New RLS policy `team_invites_invitee_select`: lets someone see a pending, unexpired invite addressed to their own email (matched via `auth.uid()` → `profiles.email`), independent of team membership.
- `team.html`: for any logged-in sponsor not yet on a Team plan, the page now checks for a pending invite before falling back to the upgrade paywall. If one exists, it shows "You've been invited to join [team] on Kitscore" with a direct accept link — no more depending on email delivery or a manually shared URL.

Applied directly to `tpcriphrfrrgywycviqv` (RLS policy) and pushed to `main` (the `team.html` change) — no separate SQL file needed for this one, it's a single `CREATE POLICY` statement, folded into this doc for the record:

```sql
CREATE POLICY team_invites_invitee_select ON public.team_invites FOR SELECT
  USING (
    accepted_at IS NULL
    AND expires_at > now()
    AND email = (SELECT p.email FROM profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
  );
```

## Marketing copy correction

The "Roles & permissions" Team-tier card advertised **Admin, Reviewer, and Viewer seats** — three tiers that were never built. The real system (confirmed against the schema and v22's own audit notes, which had already flagged this exact overstatement) only has two: **owner** and **member**, with the owner-only approve/reject enforcement v23 added. Copy corrected to describe what's actually there instead of removing the claim outright, since the underlying capability (member submits, owner decides) is now real and worth advertising accurately:

> "Team members submit evaluations for review — only your account owner can approve, reject, or unlock a paid report."

"Internal approval workflow" copy was checked against the same standard and left as-is — it already matched what v23 built.

## White-labeled reports (v22's #2 priority) — MVP built this session

Reuses the existing PDFKit sponsor decision memo pipeline (`api/generate-pdf.js`) per the v22 recommendation, rather than building a parallel PDF path.

- **Schema:** `teams.logo_url` and `teams.agency_display_name` added (both nullable — blank means "use Kitscore branding", so nothing changes for teams that don't set it).
- **`team.html`:** new owner-only "White-label branding" card — agency name + logo URL, saved via a direct `teams` update (already covered by the existing `teams_update` owner-only RLS policy, no new endpoint needed).
- **`generate-pdf.js`:** when an evaluation has a `team_id`, the generator now looks up that team's branding at generation time (not baked in at unlock time) and, if set, swaps the header eyebrow from "SPONSOR DECISION MEMO · KITSCORE EVALUATION" to the agency's name and draws their logo top-right of the header card. Logo is fetched server-side from the stored URL and embedded as image bytes — no client-side asset handling required.
- Because branding is read fresh at generation time rather than stored on the evaluation row, setting it retroactively re-brands PDFs for *already-unlocked* evaluations too, not just new ones. Worth knowing before demoing — surprising in a good way, but surprising.

### Deliberately left out of this pass (worth Gina's call)
- **Logo upload:** currently a plain URL field, not a file upload to Supabase Storage. Cheap to add if the workflow of "host your own logo somewhere" is friction for actual users — a small addition to the existing `evidence` storage bucket pattern would cover it.
- **Filename branding:** the downloaded PDF filename is still always `kitscore-{creator-name}.pdf` regardless of white-labeling. Minor, but visible to the client receiving the file.
- **PDF footer disclaimer** ("This evaluation reflects Kitscore data...") was left untouched — it's a factual data-provenance disclaimer, not chrome, so it stays regardless of branding. Flagging in case Gina disagrees with that judgment call.

## Not yet tested end-to-end

Same caveat as v23 — reviewed against schema/RLS logic and read through carefully, not exercised against a live two-person team yet:
- Invite-visibility fix: log in as the invited email, confirm the "you've been invited" banner appears on the Team page without needing the raw link
- White-labeling: set a logo + name as owner, generate a PDF as either owner or member, confirm the header actually shows the agency branding and not Kitscore's

## Left for next session (from v22, updated)

- **Multi-client organization** — still untouched, still likely the stronger "why Team" story per the v22 audit: client workspaces/tagging, a pipeline/status view, a usage dashboard against the shared 150/mo quota.
- **Per-creator team notes fix** — `team_notes.creator_id` exists but the UI never scopes notes to a creator profile. Still cheap, still not done.
- **Marketing page** — "White-labeled reports" tile copy should get a similar accuracy pass now that the feature is real (currently reads fine, worth Gina's own eyes on it before calling it done). "Roles & permissions" is now corrected; everything else on the Team page is unreviewed for accuracy.
- Everything else unchanged from v22/v23's open list: API access reconsideration (Enterprise tier, not Team), 24hr-turnaround claim removal, Stripe live Price ID full pass, confidence formula weighting revisit, grant-audit across `information_schema.role_table_grants`, founding creators + PDF unlock fee question.

## Test infrastructure note

Two separate test setups now exist for the roles/approval + white-labeling features:
- **"sox 404"** team, owned by the pre-existing "GHG" test account (`plan: team`), with a standing pending invite to `akhenaton.djina@gmail.com` ("Eve Co" test account, `plan: free`) — this predates this session, set up by an earlier one.
- A duplicate "Test Team (QA)" was created this session under `gina.hamza@aol.com` for the same purpose, then deleted once the pre-existing setup was found, to avoid two conflicting invites sitting in the same inbox.

Recommend using the existing "sox 404" / "Eve Co" pair going forward for team-feature QA rather than spinning up new test accounts each session.
