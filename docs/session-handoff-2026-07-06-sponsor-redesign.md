# Kitscore — Session Handoff (July 6, 2026 — sponsor redesign + fixes)

Latest commit on `main`: `c67dc8d`

## Shipped this session

**Recovered a lost merge.** The sponsor-side blue-theme redesign (dashboard, campaigns, pricing, watchlist, history, compare, team, directory) had been fully built and conflict-resolved against main's sidebar rewrite, but the merge only went main → feature branch, never back to `main`. Production was serving none of it. Merged `fix/webhook-payment-id-and-price` into `main` and pushed — this is why sponsor upgrades appeared to "not show" after login.

**Fixed a recurring icon-rendering bug across the sponsor pages.** `team.html`, `directory.html`, and `history.html` were still linking the Tabler webfont CDN and using `<i class="ti ...">` classes, while every other redesigned page had already switched to the inline-SVG `icons.js` system specifically to avoid icons going blank if that CDN is slow/blocked. Consequences this caused, now fixed:
- Team page's 9-feature grid: several icons were rendering blank or (once given a name) were the wrong shape entirely. Corrected all 9 against the actual mockup file.
- Directory's watchlist "save" heart button: fully wired up in JS (insert/delete on `watchlists`, plan-limit enforcement) but invisible — looked like the button didn't exist.
- History's lock icon: same fix, minor.

**Fixed a real logic bug in `history.html`.** The Free-plan banner claims "only your most recent evaluation per creator is shown," but the query returned full history regardless of plan. Now dedupes to most-recent-per-creator when `plan === 'free'`.

**Pricing page (`pricing.html`) brought in line with the mock.** Team plan's feature list was 4 generic bullets; replaced with the mock's actual 7 items (audit trail export, score-change alerts, roles & permissions, white-labeled reports, API access, priority turnaround, dedicated contact). Added the missing `desc` line above each plan's bullet list (all three tiers) to match the mock's card structure.

## Needs your decision

**No "N free evaluations" quota exists anywhere in code.** Current model is pure pay-per-report: viewing a creator always creates an `evaluations` row (unlocked:false) for the free Trust Score preview; the $29 payment (or Starter/Team monthly quota) unlocks that same row via the Stripe webhook. If you want an actual "first 3 evaluations free, then $29 each" promo, that's a new feature to scope, not a bug fix.

## Open — Team page features are marketing copy only, not built

The Team plan's 9-feature grid (and the matching 7-item pricing bullet list) describes real product capabilities, but **only the teaser/paywall UI exists** — none of the underlying features are implemented yet. Backlog for a dedicated build session:

1. Compliance-ready audit trail export (PDF/CSV log of evaluations, approvals, sign-offs)
2. Score-change alerts (notify sponsor when an approved creator's trust score drops)
3. Priority 24hr turnaround (vs. standard 48hr) — needs a queue/SLA mechanism to even mean something
4. API access (read evaluations programmatically)
5. Roles & permissions — Admin/Reviewer/Viewer seats (currently `team_members.role` is just a free-text default `'member'`, no permission enforcement anywhere)
6. White-labeled reports (agency logo on PDF instead of Kitscore's)
7. Internal approval workflow — partially exists (`evaluations.approval_status`, submit/review UI in `evaluate.html`), needs review against the full spec
8. Shared notes & collaboration — exists (`team_notes` table + UI), already functional
9. Dedicated account contact — this one is an ops/support commitment, not code

Items 7 and 8 already have real backend support; the rest (1–6, 9) need scoping and building from scratch. Flagging so nobody assumes the Team plan is feature-complete just because the marketing page looks finished.
