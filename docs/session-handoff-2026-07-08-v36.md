# Kitscore — Session Handoff (July 8, 2026 — v36)

**Context:** direct continuation of v35. Gina confirmed the dashboard reorg looks right visually, then asked to finalize the Pro gate list to 6 items total and sync pricing everywhere.

Latest commit on `main`: `c2c146f`.

## Final Pro feature list (6 gates, all real/enforced now)

1. Unwatermarked, full Proof Packet PDF export — pre-existing
2. Complete score history & trend tracking — built v34
3. Unlimited connected platforms (founding creators exempt) — built v35
4. **Verified sponsorship reputation** (reliability score, would-hire-again %, repeat sponsor rate) — gated this session
5. **Automatic evidence-freshness email reminders** — gated this session
6. **Evidence log export (CSV) with analytics** — built + gated this session, new feature

## New this session

**#4 — Reputation stats gated.** Free creators with verified campaigns now see a blurred teaser + upgrade CTA instead of the real numbers. Important nuance, not something to silently "fix" without noting: `reliability_score` is still shown unconditionally on the public shareable profile (`p.html`, built by the parallel session) — that's intentional, sponsors need to see it to trust a creator regardless of the creator's own plan. Added a line clarifying this on the locked dashboard card so it doesn't read as a contradiction.

**#5 — Freshness emails gated, UI badge stays free.** `scripts/send-evidence-expiry-nudges.js` now skips sending to non-Pro creators (still marks them as "skipped" in the log, doesn't error). The `freshnessBadge()` indicator in `evidence.html` stays visible to everyone — it's free/informational, costs nothing, and the tooltip now tells free creators Pro gets emailed automatically as an upgrade nudge.

Found this feature was built by the parallel session as a **manually-run script**, not a deployed cron — confirmed by reading its own header comment. I don't have `RESEND_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in this sandbox, so **I could not actually trigger a real test email**. To test it for real: run it locally with those two env vars (from Vercel's project settings) plus the Supabase URL — command is in the script's header comment. Flagged clearly to Gina rather than claiming I tested something I couldn't.

**#6 — New feature: evidence log CSV export.** Client-side CSV generation (file name, evidence type, platform, status, uploaded/reviewed timestamps) via Blob download, no new API route needed since the data's already loaded on the page. Pro-gated: free creators see an upgrade link instead of the export button.

## Pricing cards synced

Both `app/pricing-creator.html` and `index.html` Pro lists now show all 6 items. Free lists unchanged from v35 (already accurate).

## Verification

Syntax-checked all five touched files (dashboard.html, evidence.html, pricing-creator.html, index.html, send-evidence-expiry-nudges.js) before committing. No conflicts with the parallel session — checked `origin/main` immediately before push, nothing new landed.

## Still outstanding from v35 — unchanged

1. **Visual browser check of the dashboard reorg** — now three sessions without this. Highest priority.
2. **Test the evidence-freshness email for real** — needs someone with the Vercel env vars to run the script locally, or wire it into a proper cron+API route so it doesn't depend on manual runs at all.
3. Real click-through as owner + member test accounts — nine sessions overdue.
4. Weight-split decision.
5. Disclosure compliance — on hold per Gina's call.
6. 150/mo quota enforcement decision.
7. `notification_failures` table check.
