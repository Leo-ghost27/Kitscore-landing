# Kitscore — Session Handoff (July 6, 2026 — v22, consolidated)

**Context:** two sessions worked on this repo in parallel this window again (same pattern flagged in v21) — one on the sponsor side (branch work, still unmerged), one on the creator/admin side (against `main` directly). This doc reconciles both into one handoff.

## Session A — Creator dashboard, admin panel, data integrity, homepage (against `main`)

**Creator dashboard**
- Redesigned stat cards (Evidence Items / Campaigns / Profile Complete): cream background → white square cards with blue icon chips, matching the locked brand system.

**Admin panel**
- Fixed a critical bug: the `profiles` table was missing a `SELECT` grant for `anon`/`authenticated`, causing "permission denied for table profiles" on Evidence Review. RLS was already correct — table-level grant issue, now fixed. **(Same root-cause pattern as the sponsor-side `creators` table fix below — see note at the bottom.)**
- Verified Jacqueline's and Halima's dashboards render correctly with no broken states (badge tier, header, niche/location nulls all handled gracefully).
- Traced Jacqueline's trust score (20) to source: one `brand_safety` component at 100 value × 0.20 weight, derived from her actual questionnaire answers. Confirmed correct.
- Identified a gap: admins have no visibility into a creator's actual brand-safety questionnaire answers, only the derived score. Flagged as a to-do.
- Built a new **admin Directory** page: searchable table of all creators (name, email, plan, trust score, badge/founding status, signup date) with a **Flag for review** action, writing to a new `admin_flags` audit table (who/when/why) rather than silently changing account state.

**Data integrity**
- Discovered test/demo creator accounts (Eve H, Fiona, Fiona R) were visible in the real, sponsor-facing public directory and Compare tool alongside genuine creators.
- Added an `is_test` flag to `creators`, excluded flagged accounts from the public directory and sponsor-side Compare. Confirmed real signups (Halima, Jacqueline) untouched.

**Marketing homepage**
- Seeded Eve H's test account with realistic (not maxed-out) demo data: trust score 86 across 5 weighted components, a mutually-verified campaign with a paired test sponsor, consistent brand-safety answers — safe for screenshots now that the account is hidden from the real directory.
- Replaced homepage product screenshots with six real, current screens: **Creator view** (Dashboard, verified Campaign, Evidence upload) and **Sponsor view** (Directory, Campaign logging, Compare). No mockups.

**Homepage maturity review (vs. CreatorScore.io):** reading as a real, coherent SaaS now, not a landing page bolted onto a prototype. Real screenshots back up the "real product" claim; the Self-Reported / Evidence-Submitted / Live-Verified source-label system is a genuine differentiator, more rigorous than tools that hand over one opaque number; table stakes (Privacy/Terms/Cookie, methodology page, sample reports, FAQ, footer) all done properly. Where CreatorScore is ahead is scale/infrastructure, not trust-model rigor: 7 AI-scoring agents across 12 platforms vs. Kitscore's manual self-reported + mutual-confirmation model, a published API, a free-tools SEO funnel, an attribution/ROI product line, active content marketing. Kitscore's model trades scale for rigor — a legitimate differentiator if leaned into rather than competed against on breadth.

## Session B — Sponsor dashboard, payments, confidence score (branch: `fix/webhook-payment-id-and-price`, **merged to `main` — see Update below**)

**Sponsor dashboard redesign** — applied the new blue-theme sponsor mock across all 7 sponsor-facing pages (Directory, Campaigns, Watchlist, History, Compare, Team, Plans) plus the shared sidebar. Supabase queries/handlers untouched — purely visual. Iterated against the actual mock spec after an initial pass missed details (trust-score bar structure, Team-vs-Starter "most popular" placement, watchlist usage dots, campaigns side panel, Team upgrade feature grid) — now matches.

**Merged `main`'s parallel sidebar rewrite into this branch already** — `main` picked up an independent sidebar redesign (real account name, inline SVG icons, new `icons.js` helper) while this branch was in progress. Conflicts in `nav.js`/`shared.css`/`campaigns.html` hand-resolved: kept main's sidebar internals, recolored to the new mock's theme, kept the sponsor-page work. So this branch is currently **ahead of and compatible with** `main` as of this doc — merging it will not re-surface that conflict.

**Stripe checkout was completely broken** — resolving to a deleted/invalid Price ID (`No such price`), blocking every $29 unlock and Starter/Team subscription. Root cause: `STRIPE_PRICE_REPORT` env var pointed at a stale ID; fixed directly in Vercel. The `evaluation_unlock` fallback (`STRIPE_PRICE_EVALUATION_UNLOCK || STRIPE_PRICE_REPORT`) needed no code change once that was corrected.

**Webhook wasn't recording `stripe_payment_id` on unlock** — set `unlocked: true` on `checkout.session.completed` but never wrote which payment caused it. Now stores `session.payment_intent` (falls back to `session.id` for subscription-mode).

**Found and reset 2 unlocked-with-no-payment evaluation rows** (Sophie Lau/Eve Co, Aaliya Ahmed/Bloom Beverages) — leftover test data, not an exploitable path, but real unpaid access sitting live. Reset to `unlocked: false`.

**Sponsor-side watchlist RLS bug** — `permission denied for table creators`. Same shape as Session A's `profiles` fix: `authenticated`/`anon` had every grant except `SELECT` on `creators`. RLS was correct but never evaluated because Postgres rejected at the grant level first. Fixed.

**`confidence` score — had no calculation logic. Resolved this session.**
- The problem: `creators.confidence` was a raw stored column, never computed anywhere, despite copy promising it updates ("verify your first campaign to unlock a real confidence rating," "upload evidence... to raise your confidence rating").
- A second, conflicting "confidence" was found in the process: `evaluate.html` had its own inline High/Moderate/Low badge derived purely from `trust_score` thresholds — conflating score *magnitude* with *certainty in the score*. Fixed to read the real stored value instead.
- **Formula** (combines two established industry paradigms):
  - *Component completeness* (data-completeness confidence, same family as credit-bureau "insufficient data" flags): weighted fraction of `score_components` with `status = 'done'`.
  - *Volume factor* (sample-size confidence via Laplace/additive smoothing, same family as Wilson score / Reddit ranking / Amazon-eBay seller ratings): `verified_campaigns / (verified_campaigns + 3)` — asymptotic toward 1, never fully saturates on a thin history.
  - `confidence = round(100 * (0.6 * completeness + 0.4 * volume_factor))`
  - 60/40 toward completeness: fully-verified components with a short campaign history should still read as reasonably confident; the reverse (lots of campaigns, unverified components) shouldn't cap out high.
- Implemented as `fn_recalc_confidence()`, same trigger-function pattern as the existing `trust_score` trigger (`fn_recalc_trust_score`). Triggered off both `score_components` and `campaigns`. One-time backfill run for all existing creators.
- Sanity-checked post-backfill: a founding creator with trust_score 91 came back at 33% confidence — correctly surfacing strong campaign volume but unverified components, rather than falsely implying full confidence just because the score is high.

## Update — post-merge follow-up (same day)

By the time this doc was written, another session had **already merged this branch into `main`** (`fc28971`) and shipped good follow-up cleanup on top — fixed several Tabler-webfont icon classes I'd left in `directory.html`/`history.html`/`team.html` that rendered blank (class names not in the webfont build), fixed a real logic bug in the Free-plan history banner (copy claimed dedup to most-recent-per-creator, query didn't enforce it), and corrected some Team feature-grid icons/copy against the mock. All confirmed live on `main`.

What was still missing from `main` at that point: my last few commits (the `evaluate.html` confidence-badge fix, this doc). Synced those over with a clean, conflict-free merge, pushed to `main` directly.

**Follow-up icon sweep**, prompted by the fixes above: checked `watchlist.html`, `compare.html`, `pricing.html`, `campaigns.html` for the same blank-icon issue. No actual bug in any of the four — `watchlist`/`compare` never used icons at all, `pricing` never used icons, `campaigns` was already fully on `icons.js`/`svgIcon()` from the earlier merge. Removed the dead, unused Tabler CDN `<link>` from `watchlist.html`/`compare.html`/`campaigns.html` anyway (one less thing that can fail to load). **Left the CDN link in place on `admin-directory.html`, `dashboard.html`, `profile.html`, `evidence.html`, `evaluate.html`, `pricing-creator.html`, `auth.html`, `accept-invite.html`, `admin-signups.html`** — outside this session's scope (creator/admin side), some may have working webfont icons still in active use there. Worth a check by whoever owns that side.

**History page empty-state bug, caught from a live screenshot:** the "No evaluations yet" message was rendering as bare text directly on the gray canvas — never got wrapped in `.card` like every other empty state (watchlist, campaigns, directory) was. Fixed.

## A pattern worth naming explicitly

Both sessions independently hit **the identical bug shape** this window: a table with correct RLS policies but a missing base-level `SELECT` grant for `anon`/`authenticated` (`profiles` in Session A, `creators` in Session B) — `permission denied for table X`, not a silent empty-result RLS miss. Combined with v21's finding of a standing `ALTER DEFAULT PRIVILEGES` rule that auto-grants full access to new tables before RLS is written, this looks less like two isolated typos and more like a systemic gap in how tables get provisioned in this project. Worth a one-time audit of `information_schema.role_table_grants` across every table rather than waiting for each one to surface as a user-facing error.

## Team tier ($299/mo) — product assessment, not just a bug audit

Reviewed all 9 features currently advertised on the Team upsell page against what's actually built. Result: **1 of 9 is real (with a gap), 1 more is scaffolded-but-not-enforced, the rest don't exist — and "24hr priority turnaround" may describe a queue/SLA that isn't real for any plan**, since evaluations appear to render on-demand with no queue system found anywhere in the codebase. This is a live trust/liability question on the highest-priced tier, not a backlog item — worth fixing before more people pay for it.

| Feature | Built? |
|---|---|
| Shared notes & collaboration | Built, but not to spec — `team_notes` has a `creator_id` column the UI never uses, so notes are generic team-wide, not "on a creator's profile" as advertised. Cheap fix. |
| Team member invites | Built. |
| Roles & permissions (Admin/Reviewer/Viewer) | Scaffolded, not functional — `role` column exists but invites always create `'member'`, nothing checks role to gate any action. |
| Compliance-ready audit trail (PDF/CSV) | Not built. |
| Score-change alerts | Not built. |
| API access | Not built. |
| White-labeled reports | Not built. |
| Internal approval workflow | Not built. |
| Priority 24hr turnaround | Not built, and likely not even true today for any plan — no queue/SLA system found. |
| Dedicated account contact | Ops commitment, not code — fine to keep if there's a real distinct contact behind it. |

**Product opinion, not just an audit finding:** Roles/permissions, internal approval workflow, and white-labeled reports are the right features to prioritize — they're the actual reason a team would pay for *Team* over Starter (shared, permissioned, client-presentable workflow), and white-labeling fits Kitscore's likely buyer (an agency presenting findings to their own client) especially well. API access is probably mis-tiered — it's the biggest engineering lift on the list for a buyer who more likely wants clean deliverables than integration work; more of an Enterprise-tier feature than a $299 one. "Dedicated account contact" and (as currently written) "24hr turnaround" don't really justify the price on their own.

**The bigger gap: nothing here addresses multi-client organization**, which is likely the single most valuable thing to an agency buyer — client workspaces/tagging so evaluations don't bleed across client accounts, a pipeline/status view (Prospecting → Under Review → Approved → Active) instead of a flat history list, and a usage dashboard showing how much of the shared 150/mo quota the team has used and by whom. None of the current 9 features cover this, and it's arguably a stronger "why Team" story than API access or the audit-trail export.

**Recommended build order:** (1) per-creator notes fix + real role enforcement — cheap, uses existing schema; (2) audit-trail export + white-labeling — reuses the existing PDF pipeline; (3) score-change alerts — reuses the `fn_recalc_trust_score`-style trigger pattern and existing Resend integration; (4) internal approval workflow — needs roles done first; (5) API access — do last, or reconsider whether it belongs on this tier at all. Multi-client workspaces/pipeline view isn't scoped yet but worth a real look given it may outrank several of the above in actual buyer value.

**Presentation recommendation:** don't keep a marketing grid implying 9 live features when ~1.5 are real. Split into "Included now" (accurate) and "Shipping soon" (roadmap, clearly labeled), rewrite or drop the 24hr-turnaround claim until it's true, and drop "dedicated account contact" unless there's a real channel behind it.


## Update — verification pass + Team page polish (July 7)

**Verified all 4 items reported as "done and pushed" this session — all confirmed genuinely live**, not just claimed: invite-visibility RLS + banner, roles/permissions copy correction, white-labeled reports MVP (schema + owner settings card + PDF branding swap all checked directly against the DB and code, not just read from a doc).

**Ran the full internal-approval-workflow end-to-end test that v25 flagged as still needed**, using the same impersonation technique (`SET LOCAL ROLE authenticated` + real `auth.uid()`, wrapped in a transaction and rolled back) against the real two-person team (GHG/owner, Eve Co/member). All 8 steps passed: member creates draft → submits for review → blocked from self-approving (trigger works) → files a spend-approval request → owner approves both the evaluation and the spend request.

**Found and fixed a 4th instance of the recurring grant-pattern bug** — the exact issue named in this doc's "pattern worth naming explicitly" section, now with one more data point: `approval_requests` had correct RLS but zero base `GRANT` for `authenticated`. This one was live and user-facing, not theoretical: `api/request-approval.js`/`review-approval.js` use the service-role client so the *write* actions worked, but `team.html`'s Pending-Approvals queue (owner) and Your-Requests history (member) read the table directly client-side as `authenticated` — meaning **the owner's approval queue was silently broken in production** until this was caught. Fixed with `GRANT SELECT, INSERT, UPDATE ON approval_requests TO authenticated`, then re-ran the full test to confirm the exact queue queries the UI uses now succeed. Worth escalating the grant-audit recommendation below from "worth doing" to "do this soon" — four for four now.

**Team page: reorganized the feature grid and added polish, per direct feedback that the presentation looked rudimentary.** Split the 9 advertised features into two labeled sections now that 4 are genuinely real: **"Included now"** (green pulsing "Live" chip) — Roles & permissions, Internal approval workflow, White-labeled reports, Shared notes & collaboration — versus **"Shipping soon"** (existing blue "Team" chip) — audit trail, score-change alerts, API access, dedicated account contact. Combined the Roles/Internal-approval copy to describe the real owner-approves-spend-requests mechanism accurately in both tiles rather than two overlapping descriptions of the same thing. Added staggered fade-in-up entrance animation on the tiles and hero card, hover lift + icon-scale on tiles, with a `prefers-reduced-motion` fallback.

**Dropped "Priority 24hr turnaround" from the page entirely** rather than carry it into "Shipping soon" — per this doc's earlier finding that it likely describes a queue/SLA that doesn't exist for any plan today. Didn't rewrite or quietly relocate it; removed it and I'm flagging that decision here explicitly rather than making the copy call unilaterally. Needs Gina's word on whether/how it comes back (e.g., as a real feature once a queue exists, or dropped from the roadmap entirely).

**Caught my own bug before it shipped:** the first pass at the tile-rendering helper accidentally left a duplicate `const tile` declaration in place (a leftover from fixing which icon system to use) — a JS syntax error that would have crashed the whole page. Caught via `node --check` on the extracted inline script before pushing, not after.

## Needs your action

1. ~~Merge `fix/webhook-payment-id-and-price` into `main`~~ — **done**, live on `main` as of the Update section above.
2. Founding creators + PDF unlock without the $19.99 Pro fee — you were reviewing this yourself; still open.
3. Team tier feature-list mismatch (homepage vs. in-app upsell page list different features for the same $299/mo tier) — needs reconciling, not done by either session.
4. Stripe live Price ID cross-check — the report/unlock price is fixed and verified working this session; still worth a full pass on Starter/Team/Creator Pro IDs if not recently checked.
5. Confidence formula weighting (0.6/0.4, k=3) is a reasonable default, not gospel — revisit once there's more real campaign volume to see how it feels in practice.
6. Grant-audit mentioned above — one-time pass across all tables' `information_schema.role_table_grants`, given this is the second independent instance of the same bug shape.
7. Unchanged from v21: leaked password protection (settled "no"), YouTube→footer (on hold), Anthropic billing (your call), RLS performance on 4 low-traffic tables (deliberately deferred).

## Open / not built (either session)

- Creators can browse the sponsor list (mirror of sponsor Directory, reversed) — not scoped.
- Admin Directory "promote" action (role change, founding grant) — deferred, flag-only by instruction for now.
- Flagged creators don't yet surface anywhere besides the admin Directory page itself.
- Sponsor endorsement flow — still not integration-tested against a real live login.
- XP/gamification system — discussed, not built.
- Audience-demographics on-screen parity in `evaluate.html` (currently PDF-only) — easy follow-up if wanted.
- Whether `evidence_status` (self-reported vs. platform-verified) should factor into the confidence formula's completeness term, since `status='done'` currently doesn't distinguish the two — worth a look if that distinction matters for confidence specifically.
