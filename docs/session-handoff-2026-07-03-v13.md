# Kitscore — Session Handoff (July 3, 2026 — v13)

Latest commit on `main` before this push: `9590538` (from a parallel session — see note below). This push adds on top of it.

**Note on parallel work:** a separate session worked on this same repo during this window — removed the dead hero search bar, added real niche filters to `directory.html`, added an FAQ, added a thin "For Creators" band, diversified the homepage's static fallback creator rows, and built `compare.html` naming CreatorScore directly. Their own doc is `docs/landing-page-review-2026-07-03.md`. Flagging this because it caused one real collision (below) — worth knowing two sessions can step on each other's DB state on this project.

## Shipped this session

**De-identified `compare.html`.** Removed every direct "CreatorScore" mention (title, meta tags, headline, body copy, table header, pricing cell, homepage link labels) and replaced with generic "AI content-scoring tools" framing. Kept the actual comparison content — it was well-sourced (agent count, pricing tiers, OAuth vs. scraper distinction) — just stopped naming the specific company. Softened the exact `$19.99/$29.99` pricing citation (which was specific enough to still identify the company to anyone who'd recognize it) to a `$15–$30` range.

**Built `for-creators.html`** — the dedicated founding-creator acquisition page, matching the mockup shown in chat earlier and `compare.html`'s established design system (same nav, footer, Playfair Display headings). Includes:
- Founding Creator Cohort (first 100) hero framing
- 3 value-prop cards (free media kit, permanent founding badge, discovery)
- 3-step signup flow
- Jordan Ellis example card (reusing the existing fictional persona already established elsewhere on the site, not a new invented one)
- **Live founding-spot counter** — reads the real count from Supabase (`founding_cohort = true`) via the anon key, same pattern the homepage directory preview already uses. If the fetch fails for any reason, the counter hides itself rather than show a stale or fake number — no fabricated data path.
- `index.html`'s "For Creators" band now links here instead of straight to `auth.html`.

**Founding-cohort DB work — mostly already done by the parallel session, finished the gaps:**
- The `founding_cohort` column and its auto-flagging trigger (`fn_set_founding_cohort`, flags `true` for the first 100 signups by count) already existed when I checked — that session had done more than their own doc claimed at the time I last read it.
- **Backfilled the 6 existing real creators** to `founding_cohort = true` — the trigger only fires on INSERT, so anyone who signed up before the trigger existed was never flagged, even though they're obviously within the first 100 by any honest reading of that promise.
- **Granted `SELECT` on the `founding_cohort` column to `anon`/`authenticated`** — it wasn't in the column allow-list from last session's `business_email`/`stripe_customer_id` lockdown (that list predates this column), so `for-creators.html`'s counter would have hit a permission-denied error without this.
- **Revoked `EXECUTE` on `fn_set_founding_cohort`** from anon/authenticated — same trigger-only cleanup as `fn_enforce_watchlist_limit`/`fn_recalc_brand_safety` from last session, just added afterward by the parallel session so it never got the same treatment.

**Real collision found and fixed: the `creators_directory_public` SECURITY DEFINER ERROR-lint was back.** Last session's fix (`security_invoker = true`) had been silently reverted — the parallel session's work (likely adding `founding_cohort` to the view's column list) did a `CREATE OR REPLACE VIEW` without carrying that storage option forward, which Postgres doesn't preserve automatically. Reapplied it. **Worth knowing for next time:** any future edit to this view needs `WITH (security_invoker = true)` in the same `CREATE OR REPLACE VIEW` statement, or this regresses again silently with no error at edit time — it only shows up on the next security scan.

## Needs your action

1. Same open items as before — domain redirect, Anthropic credits, Stripe live price ID.
2. Worth a heads-up to whoever ran the parallel session (or your future self in that thread) about the view regression above, so it doesn't happen a third time.
3. Consider whether `docs/landing-page-review-2026-07-03.md`'s diversified static fallback rows (7 fictional creators with tuned scores, shown on the homepage directory preview until real data exists) need the same treatment as the "500+" fix from earlier — it's specific fabricated people with specific fabricated scores, not just an aggregate stat. Flagged to you in chat, not yet acted on.

## Open — carried over + updated

* ~~CreatorScore named directly on the page~~ — de-identified, comparison content kept.
* ~~Founding-creator acquisition page~~ — built (`for-creators.html`), live counter, linked from the homepage band.
* ~~`creators_directory_public` SECURITY DEFINER (2nd occurrence)~~ — fixed again, with a note on why it keeps happening.
* Domain apex/www redirect — still needs you in the Vercel dashboard.
* Anthropic credits / Stripe live price ID — still unresolved.
* **New, not yet decided:** homepage's diversified static fallback creator rows — same category of concern as the false hero stats, not yet addressed.
* XP/gamification system — still just discussed, not built.
* 3 RLS-helper functions callable by anon — accepted as standard pattern, no action planned.
