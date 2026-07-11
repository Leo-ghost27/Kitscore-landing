# Landing Page Visual Audit — index.html
Started 2026-07-10 · Living doc, updated as items are found/fixed.

Scope: `index.html` internal consistency — fonts, backgrounds, section rhythm,
visual claims. (Creator-side pricing/screenshot audit against `app/pricing-creator.html`
and `for-creators.html` was completed separately earlier the same day — see prior
commits `3519b51`, `d7467c4`, `f94ae8b`, `cc03a88`, `6e09296`, `9925424`.)

## System (for reference)
- Display font: `Fraunces` (serif) — used via `.section-h` on every major heading
- Body font: `Inter` (sans) — via `var(--font)`
- Band rhythm: alternates white (`var(--bg)` / `#FFFFFF`) and cream (`.band-alt`, `var(--bg-alt)` / `#FAF8F3`)
- Default section spacing: `padding: 80px 2rem; max-width: 1100px` (base `section` rule)
- Narrower content sections (`reputation`, `decision-memo`, `faq`) intentionally
  use `max-width: 960px` / `800px` — this is a deliberate editorial-width choice,
  not a bug.

## Findings

### 🔴 FIXED — CTA band headline breaks the serif-heading pattern
`<h2>` in the closing CTA band ("The smarter way to sponsor.", line ~1507) is
fully inline-styled and never sets `font-family`. Every other `<h2>` on the
page uses `.section-h` → `font-family: var(--font-display)` (Fraunces). This
one silently falls back to body Inter — meaning the single highest-visibility
headline on the page (last thing before conversion) is the only one not in
the premium serif. Font-weight also drifted (700 vs. 600 everywhere else).
**Fix:** added `font-family: var(--font-display)` and aligned weight to 600.
Pushed in commit `ced446e`.

### 🟢 FIXED — band-alt rhythm break
Resolved by merging "Sample Reports" + "See It In Action" into one continuous
white section (divider removed between them). Merging drops one section from
the alternating count, so keeping the merged block **white** (not cream)
restores perfect alternation for every section after it with zero other
changes needed — the fix was simpler than it first looked.
Pushed in commit `aae03f8`.

### 🟢 FIXED — comparison block structural asymmetry
"Other tools ask" (left column) had only an eyebrow + question, while
"Kitscore answers" (right column) had eyebrow + bold headline + explanatory
subline — leaving the left side visually sparse/unfinished next to the right.
Added a matching subline to the left column ("A single metric, disconnected
from any hiring decision.") so both sides share the same structure while
preserving the intentional muted-vs-bold tone contrast.
Pushed in commit `aae03f8`.

### 🟢 Reviewed, no issue — worth noting so it isn't re-flagged later
- App-side pages (`app/*.html`) intentionally use a second typeface,
  `IBM Plex Mono`, for uppercase eyebrow/tag labels via `shared.css`'s
  `--font-mono`. This is a deliberate marketing-vs-product typography split,
  not drift — confirmed by checking `shared.css` is shared across all app
  pages consistently.
- Section vertical padding varies 64px vs. 80px depending on section (some
  override the 80px default inline, some don't) — checked whether this reads
  as a real inconsistency or normal editorial variation. Given the max-width
  tiers already vary intentionally (960px/800px sections are content-dense,
  1100px sections are visual/grid-heavy), the padding variance tracks the
  same logic and reads as intentional, not sloppy. Not flagging as a fix
  unless you want strict spacing-scale enforcement.
- Directory avatar colors (`#2563EB`, `#DB2777`, `#7C3AED`, etc.) — varied
  brand colors for mock creator initials. Intentional visual variety for a
  sample directory list, not a design-system leak.

## Next up (pending your steer)
Sponsor-side review — bigger scope, tomorrow per your note.

---

## Sponsor pricing/messaging pass — 2026-07-11

### 🟢 FIXED — pricing synced across landing / agencies / checkout
Tier 1 had three different names ("Single Evaluation" / "Pay as you go" /
"Pay per report") and three different feature lists for the identical $29
product. Renamed to **"On Demand"** everywhere, unified feature list to the
richest/most accurate version, and synced Starter + Team wording across all
three surfaces (`index.html` #pricing-sponsors, `agencies.html`,
`app/pricing.html` checkout). Enterprise/Custom confirmed correctly absent
from the landing page, present only on agencies + checkout, per your rule.

### 🟢 FIXED — Pro pricing bullet was overselling
"Verified sponsorship reputation — reliability, would-hire-again %,
repeat-sponsor rate" implied all three were Pro-exclusive. Checked
`app/p.html` (public shareable profile) directly: reliability_score and
would_hire_again_pct are unguarded and show for free creators. Only
repeat_sponsor_rate is genuinely Pro-only. Reworded to "Repeat-sponsor rate,
plus your full reputation breakdown always up to date in your dashboard."

### 🟢 FIXED — "Sponsorship Intelligence" → "Sponsorship Due Diligence"
AI-adjacent branding swapped for a name that still sounds premium without
implying AI, which would've undercut the site's own anti-AI-scoring
positioning (see compare.html).

### 🟢 CHECKED — AI's role claim on compare.html
Was already fixed in a separate session before I re-checked (confirmed via
fresh fetch + commit history) — no longer claims AI narrates the memo.
Verified against the actual code (`api/generate-evaluation.js`): deterministic
template, zero AI API calls anywhere in the codebase. No action needed.

### 🟢 FIXED — CTA text unified
Was 5+ different variants for the same actions. Standardized:
- **Nav CTA** (all pages): "Get Started"
- **Sponsor primary CTA**: "Evaluate a Creator →"
- **Creator primary CTA**: "Claim Your Founding Spot →"
Plan-specific buttons (e.g. "Start Team Plan") and genuinely different
actions (e.g. "Browse full directory") left alone — not duplicates of the
primary CTA, don't need unifying.

### 🟢 FIXED — Score terminology capitalization
"Trust Score" / "Confidence Rating" / "Reliability Score" were inconsistently
cased throughout (~28 instances across index.html, agencies.html,
methodology.html). Standardized to always-capitalized as proper product
names.

### 🟢 FIXED — Starter/Team tier gap
25→150 evals was a 6x volume jump for only 3x the price, no middle option.
Added overage pricing to Starter instead of a new tier or raising the cap
(keeps Team's collaboration features — roles, approval workflow, multi-client
— as the actual reason to upgrade, not just volume). Copy now live on
landing/agencies/checkout: **"Additional evaluations at $12 each."**

**Backend**: `lib/handlers/billing-checkout.js` now has `starter_overage`
wired into `PRICE_MAP` and `PRODUCT_CONFIG` as a one-off payment product
(same pattern as `report`/`evaluation_unlock`), reading from a new env var
`STRIPE_PRICE_STARTER_OVERAGE`. **This is checkout plumbing only** — it does
not yet include the logic to detect a Starter sponsor has hit their 25/mo
cap and prompt the overage purchase in the UI. That's a separate, still-open
piece of work (likely lives in the evaluate/directory flow, checking usage
against the cap before letting a Starter sponsor run an evaluation).

**To finish wiring this up, in Stripe:**
1. Stripe Dashboard → Product catalog → **+ Add product**
2. Name it something like "Starter Overage Evaluation" (keeps it distinct in
   your Stripe reporting from the $29 On Demand product, even though the
   checkout code treats it the same way — a one-off payment)
3. Set pricing: **$12.00, one-time** (not recurring — this is per-evaluation,
   charged each time a Starter sponsor goes over their 25/mo)
4. Save, then open the price you just created and copy its **Price ID**
   (starts with `price_...`)
5. In Vercel → your Kitscore project → Settings → Environment Variables →
   add `STRIPE_PRICE_STARTER_OVERAGE` = that Price ID → apply to Production
   and Preview → redeploy so the serverless functions pick it up
6. Once that's live, the checkout endpoint will accept
   `{ product: 'starter_overage' }`

---

## Starter Eval Cap — Built (2026-07-11)

**Bigger finding than expected**: checked `evaluate.html`'s unlock flow before
building the cap and found there was no cap to build on top of — every
sponsor, regardless of plan, hit the same $29-per-evaluation paywall.
Starter/Team subscribers were paying $99/$299 per month for zero actual
included evaluations; nothing in the codebase checked `sponsor.plan` before
charging. Confirmed via search: no usage/credit tracking table existed
anywhere (`evals_used_this_period`, `eval_credits`, etc. — zero hits).

**Built for Starter, end to end:**
- New `sponsors` columns: `evals_used_this_period`, `period_start`
  (migration `supabase/2026-07-11-starter-eval-cap.sql`, already applied
  live via Supabase MCP — not just a file sitting in the repo)
- `lib/handlers/billing-checkout.js`: on `evaluation_unlock`, checks if the
  buyer is a Starter sponsor under 25 for the period — if so, unlocks the
  evaluation directly with **no Stripe charge at all**, increments the
  counter, and returns success. At/over 25, swaps to the $12 overage price
  instead of the standard $29 (`94cbeef`)
- `api/stripe-webhook.js`: new `invoice.paid` case resets the counter to 0
  on each successful renewal — deliberately not on `subscription.updated`,
  since that fires for reasons that shouldn't reset usage mid-period
  (`4348082`)

**Team plan — intentionally left out, needs your decision:**
Same $12 overage rate, a different rate, or something else entirely (e.g.
push toward Enterprise instead of a per-eval overage at that volume)? Once
decided, it's the same pattern as Starter — small addition to the same two
files, no new architecture needed.


