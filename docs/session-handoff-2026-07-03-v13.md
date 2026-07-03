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

**Fixed FAQ placement: one creator question was mixed into the sponsor-only FAQ.** The homepage FAQ is titled "Questions sponsors ask before they buy," but had "Is it free for creators to join?" sitting in it — a content mismatch, not really a positioning problem (the section's placement, right after Pricing and before the final CTA, is the right pattern). Moved that question off, and gave `for-creators.html` its own 3-question FAQ (the reclaimed question plus two natural companions) — that page had zero objection-handling at all despite being a brand-new page asking a cold audience to sign up.

**Tightened the Methodology Teaser copy** (kept as its own section, per direction — the earlier plan to merge it into Verified Reputation was reverted). Paragraph shortened from "Kitscore scores are not black boxes. Every component, weight, and confidence rating is fully documented and publicly explained — so sponsors understand exactly what they're buying" to "No black box. Every component, weight, and confidence rating is documented — so sponsors know exactly what they're buying."

**Severe, live, currently-exploitable leak found and fixed: `profiles.email` was publicly readable by anyone, zero login required.** Found while checking permissions for the admin-signups page below, not hypothetical — verified via `SET ROLE anon` before and after. `anon` held table-level `SELECT` on `profiles`, and the `profiles_select_creators_public` RLS policy lets anyone read any row where `role = 'creator'` with no column restriction. Combined, any anonymous visitor could query `/rest/v1/profiles?select=email,display_name&role=eq.creator` and get every creator's real account email — worse than last session's `creators.business_email` leak in one way: that one needed a signed-in session, this one needed nothing at all.

Same root cause as last time (table-level grant supersedes column-level restriction), but a much bigger blast radius to fix: `getCurrentProfile()` in `app/supabase-client.js` does `select('*')` on `profiles` scoped to the caller's own row, and is called on almost every page load across the entire app. A blanket revoke of the `email` column would have broken every signed-in page, not just other people's data exposure. Fix:
- Revoked table-level `SELECT` on `profiles` from `anon`/`authenticated`, replaced with an allow-list of the genuinely public columns (`id`, `role`, `display_name`, `created_at`).
- New `fn_get_my_profile()` RPC (own-row only, via `auth.uid()`), and `getCurrentProfile()` now calls that instead of a direct table select — fixed centrally in one place, so every caller across the app is covered without touching each page individually.

Verified via `SET ROLE anon`/`SET ROLE authenticated`: the exploit query now returns permission-denied, the safe columns still work, and the RPC returns null gracefully with no matching session (structural test only — couldn't fully integration-test with a real JWT, same limitation as the endorsement trigger from two sessions ago).

**Admin notifications on signup — mostly already built by the parallel session, found a real gap and fixed it.** Checking this before building anything (same lesson as the founding-cohort column two sessions ago) turned up `fn_notify_admin_on_signup()` and its trigger already fully wired: fires on every `profiles` insert, calls Resend directly via `pg_net` (no API route needed), reads the API key from Supabase Vault, fails soft into `notification_failures` on error. Genuinely good work — cleaner than the API-route approach I'd have built.

**But it was silently broken**: the `resend_api_key` secret it needs doesn't exist in Vault yet, so every signup notification would fail silently (caught by its own exception handler) with zero indication anything went wrong. No signups have hit it yet, so this hasn't visibly failed — but the very next one would have. **You need to add it yourself** — I don't have the key value (it's `RESEND_API_KEY` in Vercel, which I have no read access to, and it's a persistent production credential, not a one-time push token, so I'd rather you add it directly than paste it in chat). Run this in the Supabase SQL Editor with your real key:
```sql
select vault.create_secret('re_your_actual_key_here', 'resend_api_key');
```
One more thing worth checking once that's done: the trigger sends from `notifications@kitscore.co`, which may be a different sending address than whatever `RESEND_FROM_EMAIL` is already verified as in Resend for your other transactional emails — worth confirming that domain/address is actually verified in your Resend account, or emails will bounce even with the key in place.

**Built `app/admin-signups.html`** — the "see who signed up" half of the request, since it didn't exist anywhere. Stats strip (total / creators / sponsors / last 7 days), filterable list, newest first. Needed its own admin-only RPC (`fn_admin_list_profiles()`) for the same reason as the email fix above — admin shares the same `authenticated` Postgres role as everyone else, so the column lockdown applies to admin too unless routed through a function that checks `fn_is_admin()` internally. While building this, the query surfaced a real, very recent signup (a sponsor, today) as a live sanity check that the page actually works. Linked from the sidebar nav (`app/nav.js`).

## Needs your action

1. **Add the `resend_api_key` secret to Supabase Vault** (SQL above) — signup notification emails are wired but silently non-functional without it.
2. Confirm `notifications@kitscore.co` is a verified sending address in your Resend account.
3. Same open items as before — domain redirect, Anthropic credits, Stripe live price ID.
4. Worth a heads-up to whoever ran the parallel session about the view regression above, so it doesn't happen a third time.
5. Consider whether `docs/landing-page-review-2026-07-03.md`'s diversified static fallback rows need the same treatment as the "500+" fix — still not acted on.

## Open — carried over + updated

* ~~CreatorScore named directly on the page~~ — de-identified, comparison content kept.
* ~~Founding-creator acquisition page~~ — built (`for-creators.html`), live counter, linked from the homepage band.
* ~~`creators_directory_public` SECURITY DEFINER (2nd occurrence)~~ — fixed again, with a note on why it keeps happening.
* ~~FAQ mismatch~~ — creator question moved to its own page's new FAQ.
* ~~Methodology Teaser copy~~ — tightened, section kept as-is per direction.
* ~~`profiles.email` publicly readable~~ — fixed, same pattern as last session's `creators` fix but bigger blast radius (central `getCurrentProfile()` fix covers the whole app).
* ~~Admin signup notifications~~ — infrastructure already existed (parallel session), was silently broken (missing Vault secret), needs your action above to actually start working.
* ~~"See who signed up" admin view~~ — built (`app/admin-signups.html`).
* Domain apex/www redirect — still needs you in the Vercel dashboard.
* Anthropic credits / Stripe live price ID — still unresolved.
* Diversified static fallback creator rows on homepage — not yet decided.
* XP/gamification system — still just discussed, not built.
* 3 RLS-helper functions callable by anon — accepted as standard pattern, no action planned.
