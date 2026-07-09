# Kitscore — Session Handoff (July 9, 2026 — v38)

**Context:** direct continuation of v37. Real end-to-end QA on the shareable trust profile feature surfaced a genuine Vercel routing bug, unrelated to any application code. Resolved pragmatically — decision below.

Latest commit on `main`: `6f08dd2`.

## Shareable profile: clean URL doesn't work, decided to ship the query-string version instead

**What's confirmed working, verified live by Gina with a real screenshot:** `kitscore.co/app/p.html?slug=eve-hamza-7946c` — real data, real rendering, including the parallel session's sponsor-feedback section. The feature itself (slug generation, `fn_get_public_profile`, the page) is fully correct.

**What's confirmed broken:** the clean `kitscore.co/p/:slug` URL still 404s, even after:
- Confirming `kitscore.co` domain points to the correct Vercel project (checked in dashboard)
- Confirming the latest commit was deployed to Production (checked in dashboard)
- Redeploying with build cache explicitly disabled
- Two different rewrite rule syntaxes in `vercel.json`: a named parameter (`/p/:slug`) and a wildcard glob (`/p/:slug*`) — neither fired

This isolates the problem to something in Vercel's routing configuration beyond `vercel.json` itself — most likely a dashboard-level Redirects/Rewrites setting silently overriding the file, or something else only visible from inside the Vercel project settings. Past the point where guessing at more `vercel.json` syntax variants is a good use of time.

**Decision: ship with the working `?slug=` link, stop chasing the clean URL.** Dashboard already updated (previous session) to display and copy `kitscore.co/app/p.html?slug=...` instead of the broken clean form. Not as clean for an Instagram-bio link, but it works today, which matters more than the cosmetic win right now.

**If revisited later:** check Vercel dashboard → Settings → Redirects/Rewrites for anything conflicting with `/p/:slug` before touching `vercel.json` again — that's the one thing that couldn't be checked from this side.

## For next session

1. Real click-through as owner + member test accounts — now well past ten sessions overdue, this has been on every list for a long time.
2. Weight-split decision (5 score components still all 0.20 placeholder).
3. Set `CRON_SECRET` in Vercel for the evidence-nudge cron, if not done yet — then verify it actually fires (wait for Monday or trigger manually).
4. Disclosure compliance — on hold per Gina's call, pending OAuth.
5. 150/mo quota enforcement decision.
6. `notification_failures` table check.
7. Decide whether to revisit the `/p/:slug` clean URL later (see note above) or leave the `?slug=` link as permanent.
