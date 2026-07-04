# Kitscore — Session Handoff (July 4, 2026 — v14, consolidated)

Latest commit on `main`: `f6d79c2`

**Context:** two sessions worked on this repo in parallel this window without visibility into each other. This doc reconciles both — verified against the live repo and database before writing anything down, not just merged at face value.

## Correcting the record from the other session's doc

A few things that doc listed as "still open" are actually already done — by the time it was written, this session's work had already happened but hadn't reached that thread:

- **Admin Signups panel**: that session's commit (`887d6a4`) never reached `origin/main` — their push failed on a read-only token, exactly as their doc says. This session built and pushed its own version independently (commit `ea6e8d1`), unaware of theirs. No conflict occurred since theirs never merged, but worth knowing two sessions built the same feature in parallel. **Nothing left to push — it's live.**
- **The 500+/89% false hero stat**: fixed and pushed several commits ago (`228ffb0`), not still open.
- **`creators_directory_public` SECURITY DEFINER + the 6 mutable-search_path functions + the anon-callable trigger functions**: all fixed, in this session and the one before it — and expanded well beyond what that doc scoped ("bundle into next schema pass, not urgent" undersold it — see below). Confirmed via a fresh advisor scan just now: no ERROR-level findings remain, and my earlier fixes are still intact (no regression this time).

## What's genuinely new and correct from that session — kept

- **Domain redirect**: `kitscore.co` is Production, `www.kitscore.co` 308-redirects to it, matching the canonical tag. I can't independently verify Vercel domain config from here, but this closes an item three sessions running couldn't get done — good to have confirmed.
- **Admin signup notification is now actually working**, not just wired: `resend_api_key` is confirmed present in Vault (I checked directly), sending from `hello@kitscore.co` (corrected from a `notifications@kitscore.co` address that was never verified in Resend — that would have bounced every email). No failure logged in `notification_failures` for the one real signup that's happened since — consistent with a successful send, though actual inbox delivery still isn't something I can confirm myself.
- **AI brief backfill — real scope, not just an outage window**: confirmed via direct query — all 17 evaluations to date have `ai_generated_at IS NULL`, oldest from June 19. A 100% failure rate over two weeks is wider than "ran out of credits recently" — worth testing `backfill-ai-briefs.js` on a single record first once credits are added, not running it blind across all 17.
- **Anthropic billing is intentionally paused**, not an oversight — waiting on signup volume before attaching a card. Removing this from "needs your action" framing; it's your call, not a blocker.

## This session's actual scope (for anyone reading only this doc)

Two full audit passes across the whole Supabase project — not reactive, systematic:
1. **Every table's grants × RLS policy × column sensitivity**, all 15 tables. Root cause: every table was created with blanket read access for logged-out and logged-in users alike, before RLS was layered on. Found and fixed real, live leaks on `creators` (business_email/stripe_customer_id), `profiles` (email, readable with zero login), `sponsors` (stripe_customer_id via shared campaigns), `team_invites` (full token dump + invite-hijack via a missing ownership check), and an over-exposed `campaigns` policy.
2. **Everything else**: storage bucket policies, all 8 API routes (auth/IDOR check on each), the one database view, client-side code for leaked secrets, and Vault access. Nothing further found — this pass came back clean.

Full narrative detail on each individual fix is in the earlier per-session docs in this repo (`docs/session-handoff-2026-07-03-v13.md` and the commit messages themselves, which are written with full context) — this doc is the reconciled summary, not a replacement for that detail.

## Needs your action

1. Stripe live Price ID cross-check — still genuinely open, nobody has done this yet:
   - Stripe (Live mode) → Product catalog → copy the 5 live Price IDs
   - Vercel → Settings → Environment Variables → compare against `STRIPE_PRICE_REPORT`, `STRIPE_PRICE_EVALUATION_UNLOCK`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_TEAM`, `STRIPE_PRICE_CREATOR_PRO`
   - Fix mismatches, redeploy, run one real checkout to confirm
2. Confirm the admin signup notification email actually landed in your inbox (infra looks correct, but I can't check an actual mailbox).
3. Enable "leaked password protection" in Supabase Auth settings — one toggle, still outstanding, low urgency.
4. Anthropic billing — your call, no longer time-pressured.

## Open — lower priority, unchanged

- Audience geo/demographic data — direction agreed, not built.
- `creator_rating_submitted_at` companion column — only if/when "creator rates sponsor" ships.
- Sponsor endorsement flow — still not integration-tested against a real live login.
- Diversified static fallback creator rows on the homepage directory preview — flagged twice now as the same category of concern as the false hero stat, still not decided on.
- YouTube channel → footer — hold until ~8-10 videos up with real cadence.
- XP/gamification system — discussed, design feedback given, not built.
