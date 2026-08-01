# Scoring formulas — source of truth

Every formula that feeds a creator's Trust Score or Reliability Score,
in one place. **Check any change to a formula, a weight, or a threshold
against this doc — and update this doc in the same commit as the code
change.** methodology.html should always match this doc, and this doc
should always match the actual SQL/JS. This file exists because it
didn't: a single audit found `methodology.html` disagreeing with the
live database in five separate places (wrong weight percentages that
didn't even sum to 100%, a missing Reliability Score factor, 3 of 8
brand-safety questions never built, engagement scoring claiming
category-benchmarking it didn't do). None of that was one bad edit —
it drifted gradually because there was nowhere to check against.

Each entry below is tagged with where its numbers actually came from:

- 🔬 **External industry data** — sourced from real, cited research.
  Directional confidence, not precise — see each entry's own caveat.
- 🏗️ **KitScore product judgment** — a reasoned design decision, not a
  copied industry standard. Said plainly rather than implied to be
  more authoritative than it is. No external source claims a specific
  "correct" weighting for most of these constructs — they're fairly
  bespoke to a verified-trust-score product, not standardized metrics
  like engagement rate.

---

## Trust Score — 4 components, weighted by evidentiary strength

**Updated 2026-07-31.** Previously 5 components at a flat 20% each,
carried as an explicit unresolved placeholder since 2026-07-07 (the
original migration's own comment: *"flagging for Gina to confirm the
final weight split ... rather than guessing at 20% each"* — never
confirmed, so it just quietly became the real weighting by default).
Resolved today:

1. **Professionalism removed as a Trust Score component.** It
   duplicated `campaigns.professionalism_rating`, which already feeds
   Reliability Score's "avg. sponsor ratings" factor below — the same
   sponsor rating was moving two separate creator-facing numbers under
   two different names. It also defaulted a brand-new creator with zero
   ratings to a flat 0 (`coalesce(avg(...), 0)`), dragging down 20% of
   their Trust Score just for being new — unlike every Reliability
   Score factor, which is excluded entirely until real data exists,
   Trust Score had no equivalent "don't count what doesn't exist yet"
   handling for this one component.
2. **Remaining 4 components rebalanced** by evidentiary strength/stakes
   rather than flat 20% each (🏗️ Kitscore product judgment, same caveat
   as before — no external source publishes a "correct" weighting for
   this construct, this is not a claim to have found the industry
   number):

| Component | Weight (was) | Live source | Notes |
|---|---|---|---|
| Audience Authenticity | **30%** (20%) | `fn_apply_audience_authenticity` | Core fraud/authenticity check — raised: this is the signal sponsors most fear getting wrong (paying for a bot audience). |
| Engagement Quality | **30%** (20%) | `fn_recalc_engagement_quality_youtube` / `_tiktok` | Raised: the most consistently evidence-backed predictor of real campaign ROI across the industry generally, even though no single competitor publishes an exact weight to cite. |
| Brand Safety | **25%** (20%) | `brand_safety_penalties` table | Raised, but less than authenticity/engagement: real legal/reputational exposure for a sponsor, though it already has its own steep per-question penalty system (see below) doing more of the risk-differentiation work than the top-line weight does. |
| Content Consistency | **15%** (20%) | OAuth-connect-time app code (`google-oauth.js`, `instagram.js`, `twitch.js`) + daily resync (`cron-youtube-resync.js`) | Lowered: an activity indicator (is this creator still posting) more than a trust indicator — weaker standalone signal than the other three. |
| ~~Professionalism~~ | ~~20%~~ | *(removed)* | See Reliability Score below — same underlying rating, now lives in exactly one place. |

**Multi-platform families (Engagement Quality, Content Consistency)**
still split their total weight evenly across however many platforms are
live for a given creator via `fn_rebalance_component_family` — e.g. a
creator with both YouTube and Discord engagement live gets 15% each,
summing to the family's 30%.

**Bug fixed in the same pass:** `fn_rebalance_component_family` only
counted/updated rows with `status = 'live_verified'`, silently skipping
any sibling in a different status (`evidence_submitted`,
`needs_improvement`, `flagged`, `self_reported`) — leaving it at a
stale weight, and undercounting the divisor so whichever platform *was*
`live_verified` got over-weighted. A component being evidence-submitted
rather than live-verified affects its value and status badge, not
whether it should count toward the family's weight split. Fixed to
count/update every row in the family regardless of status. Found while
verifying today's rebalance — affected 2 real creator accounts at the
time, both corrected via a retroactive UPDATE alongside the weight
change (all existing `score_components` rows, not just future ones).

## Engagement Quality — niche multiplier

🔬 **Directionally sourced from 2026 industry engagement-by-niche
data** (IQFluence, SociaVault, and others — cross-checked, sources
disagreed by 2-4x on absolute numbers, same caveat as the rate-card
comment already notes, so only the *direction* and rough magnitude are
treated as reliable, not the precise multiplier values). `finance`/`tech`
run structurally lower than average; `fitness` runs higher; the rest
cluster near baseline. Applied as `raw_ratio / niche_mult` before
banding — same 8 niche keys as the rate card's `NICHE_RATE_MULT`, one
taxonomy, not two. See `fn_niche_engagement_mult`
(2026-07-28-brand-safety-and-niche-engagement.sql).

| Niche | Multiplier |
|---|---|
| finance | 0.60 |
| tech | 0.65 |
| sustainability | 0.85 |
| health | 0.90 |
| fashion | 0.95 |
| beauty | 1.00 |
| lifestyle | 1.00 |
| fitness | 1.20 |
| (anything else / blank) | 1.00 — general average, not a guess |

**Separately:** `fn_niche_peer_percentile` (2026-07-29, renamed from
`fn_niche_engagement_benchmark`) is a *different*, read-only mechanism
— real percentile rank against actual same-niche peers on Kitscore
itself, doesn't touch the score, requires ≥5 real peers or honestly
returns "not enough data." Complementary to the multiplier above, not
a duplicate — the multiplier fixes the score using external
benchmarks; the percentile adds honest additional context once real
platform density exists.

## Content Consistency — posting-cadence banding

🏗️ **KitScore product judgment.** Active-weeks-out-of-trailing-8,
same thresholds reused across YouTube/Instagram/Twitch (only the
timestamp field name differs per platform — `publishedAt` / `timestamp`
/ `created_at`):

| Active weeks (of last 8) | Score |
|---|---|
| ≥6 | 90 |
| ≥4 | 75 |
| ≥2 | 55 |
| ≥1 | 35 |
| 0 | 20 |

**Twitch caveat:** measures saved VOD presence, not true stream
frequency — a streamer who deletes VODs after airing won't get full
credit. Documented in `fetchTwitchVideos` and on methodology.html.

## Brand Safety — 8 questions, penalty-based

🏗️ **KitScore product judgment**, informed by what FTC/brand-safety
concerns actually matter for sponsors (paid disclosure is a real legal
exposure, not an arbitrary category). All 8 live as of 2026-07-28 (3 —
`paid_disclosure`, `misinformation`, `controversy_history` — existed on
the backend since 2026-07-13 but were never added to the actual
creator-facing questionnaire until this date). See
`brand_safety_penalties` table for exact per-answer point values; no
single question is weighted as "highest" despite methodology.html
previously (incorrectly) claiming that for paid disclosure — `adult`
(Explicit, -30) and `misinformation`/`gambling` (-25 each) both carry
steeper penalties.

## Reliability Score — adaptive weighted average

🏗️ **KitScore product judgment**, though the general *shape* (weight
completion/delivery reliability heaviest, secondary signals lighter)
matches common practice across gig/service marketplaces generally
(e.g. Upwork's Job Success Score, Uber/Lyft driver ratings, Airbnb
Superhost criteria all treat completion/cancellation as the primary
signal) — noted as informed context, not a specific cited source, since
none of those publish an exact weighting either.

Completion rate is **always** counted (it's the floor — a brand-new
creator with zero campaigns is scored on this alone once they have any
data at all). The other four are **only counted once that kind of data
exists**, and the final score is rescaled by however many factors
actually applied — so a creator with fewer data points isn't penalized
for the ones they don't have yet:

| Factor | Points | Counted when |
|---|---|---|
| Campaign completion rate | 30 | Always |
| Avg. sponsor ratings (communication, professionalism, deliverable quality) | 25 | ≥1 sponsor rating exists |
| Endorsement score | 20 | ≥1 endorsement exists |
| Repeat sponsor rate | 15 | ≥1 sponsor exists |
| Would Hire Again % | 10 | ≥1 "would hire again" response exists |

Formula: `round(score_sum / weight_used)` where `weight_used` is the
sum of only the points for factors that actually had data. See
`schema-baseline-2026-07-15.sql` for the exact function.

**methodology.html previously described this as 4 factors (missing
Endorsement entirely) with Would Hire Again weighted 30 instead of the
real 10 — fixed 2026-07-29, same session this doc was created.**

## Admin-only, not shown to creators

- **Sponsor liquidity** (`fn_admin_sponsor_liquidity`, 2026-07-28) —
  total sponsors, sponsors with ≥1 campaign, sponsors who reached
  mutual confirmation, active-last-30d, "ghost" sponsors. See
  `docs/admin-roadmap.md`.
