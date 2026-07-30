# Admin features & functions roadmap

Living list of admin-facing features/functions — built, in progress, or
proposed. Checked before starting this doc: nothing like this existed
anywhere (no file in the repo, no GitHub Issues, no GitHub Projects) —
this is the first version. Add to it going forward rather than tracking
admin work ad hoc in session-handoff docs only, so it's easy to see
what's shipped vs. still needed at a glance.

Format: one line per item, status first, link to the PR/commit that
shipped it if applicable.

## Shipped

- **Sponsor liquidity metric** (2026-07-28, `fn_admin_sponsor_liquidity`,
  `app/admin-signups.html`) — total sponsors, sponsors who've logged
  ≥1 campaign, sponsors who've reached mutual confirmation, sponsors
  active in the last 30 days, "ghost" sponsors who signed up and never
  engaged. Admin-only (`fn_is_admin()` gated), not shown to creators.
  Built because admin-signups.html could already show sponsor
  *signup* count but had no visibility into sponsor *activity* — the
  actual thing that makes a creator's trust score valuable.
  **Correction (2026-07-29):** the original first-run numbers (9 total
  sponsors, only 3 ever reached mutual confirmation) looked like a
  concerning liquidity problem, but weren't a real signal — 6 of the 9
  were seed/demo data or the user's own test accounts (cross-checked by
  company name and signup clustering). Added `sponsors.is_test`
  (matching `creators.is_test`, which already existed) and backfilled
  the 6 known non-real rows; see
  `supabase/2026-07-29-sponsors-is-test-flag.sql`. Corrected picture:
  2 real external sponsor signups, both too recent to draw any
  conclusion from yet. Without this flag, the metric would keep
  producing a misleadingly alarming headline number indefinitely.
- Admin signups list + role filter (`app/admin-signups.html`)
- Admin creator directory (`app/admin-directory.html`)
- Admin brand safety scan review queue (`app/admin-brand-safety.html`,
  `fn_admin_apply_brand_safety_scan`) — approve/reject flagged
  auto-scans before they touch a live score
- Admin evidence review (`app/admin-evidence.html`)

## Proposed / not yet built

Nothing logged yet — add items here as they come up, with a one-line
"why this matters" so the next session (or the next audit) doesn't
have to reconstruct the reasoning from scratch.
