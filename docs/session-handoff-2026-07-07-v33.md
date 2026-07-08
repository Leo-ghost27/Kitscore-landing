# Kitscore — Session Handoff (July 7, 2026 — v33)

**Context:** direct continuation of v32. Three things this session: fixed the score-hero dashboard layout Gina flagged as "all over the place," added US/UK currency auto-detect to the rate calculator, and built the full "invite a past sponsor to confirm" flow (Tier 1 rec #2) — the one item from the original creator value review that arguably matters most, since it's the actual data source for everything else the score depends on.

Latest commit on `main`: `fc74e93`.

## 1. Score hero layout fix

Root cause of the clutter: `.score-left` had the ring, the "Why is my score X?" link, and the badge stack (New creator pill / Founding / plan chip / Upgrade link) as three same-level flex-row children, all vertically centered against each other despite very different heights. Restructured to: ring stays alone on the left as the anchor; everything else now groups into one `.score-left-info` column next to it (why-link on top, badges in a wrapping row below, upgrade link as its own line under that). Added a mobile override at 560px to stack ring above the info column instead of squeezing them side by side.

## 2. Rate calculator currency auto-detect

Uses `Intl.Locale` on `navigator.language` to detect region; `US` → USD, everything else defaults to GBP (Kitscore's home market). Manual £/$ dropdown override included since detection can't always be right. USD multipliers (0.0065–0.013) are an approximate GBP→USD conversion (~1.3x), not a live FX rate — flagged as approximate in the code comment.

## 3. Invite a past sponsor to confirm (Tier 1 #2) — the big one

**Why this one over the other flagged items:** production has zero campaigns with `endorsement_submitted_at` set — confirmed a few sessions back and still true. Every fix made this week (professionalism, evidence-approval scoring, confidence) is downstream of creators actually having confirmed campaign history. This feature is the one that generates that history. Score history graph, the shareable profile link — none of them have anything real to show without this existing first.

**Design decision (researched, not guessed):** Gina wants sponsors to stay on Kitscore and browse the directory after confirming — not just tick a box and leave. Researched the industry-standard pattern for "outside party confirms something and should become a real user in one click": passwordless magic-link auth. Reused Supabase's native `signInWithOtp` rather than building a custom token-login system. Because `handle_new_auth_user` (existing trigger) already creates a real `sponsors` row the moment `email_confirmed_at` is set, a sponsor clicking the magic link becomes a genuine, logged-in sponsor account immediately — no separate "upgrade from guest" step later, no password to set.

**What shipped:**

- New table `campaign_confirmation_invites` (creator_id, sponsor_email, sponsor_name, description, budget_range, token, status, expires_at, campaign_id). RLS: creators manage only their own rows. Mirrors the existing `team_invites` pattern.
- `fn_lookup_campaign_invite(token)` — SECURITY DEFINER, public lookup for the confirm page before the sponsor is authenticated. Same anti-enumeration reasoning as `fix_team_invites_leak`.
- `fn_confirm_campaign_invite(token)` — SECURITY DEFINER, runs once the sponsor has a session. Verifies the authenticated profile's email matches the invited email (so only the actual invited person can confirm), creates the real `campaigns` row (`status='verified'`, both confirm flags true, `verified_at=now()`), marks the invite confirmed. Idempotent — calling twice just returns the existing campaign_id.
- `api/invite-sponsor-confirm.js` — creator-authenticated route (reuses `getAuthedCreator`), creates the invite row, sends the email via the existing Resend `sendEmail` utility.
- `campaignConfirmInviteEmail()` added to `lib/email.js`, same style as the existing `teamInviteEmail`.
- `app/confirm-campaign.html` — new public page. Looks up the invite, shows the campaign summary, "Confirm this sponsorship" button triggers `signInWithOtp`. On magic-link return, calls `ensureProfile()` as a belt-and-suspenders check (in case the DB trigger hasn't landed yet — same pattern already used elsewhere in `supabase-client.js`), then `fn_confirm_campaign_invite`, then shows a "Browse verified creators" CTA straight into the directory.
- `app/campaigns.html` — added the "Invite a past sponsor to confirm" button + inline form (email, optional name, optional description) to the empty-campaigns state, using the same authenticated-fetch pattern already used for `/api/notify-dispute`.

**Not yet tested live** — this needs a real click-through: creator sends invite → check email arrives → click confirm link → check magic link email arrives → click that → verify a `campaigns` row actually appears with `status='verified'` and both confirm flags true, and that the new sponsor lands in `directory.html` able to browse. Syntax-checked all four files (clean) but did not run this end-to-end against Resend/live email delivery this session.

## For next session

1. **Click-through test the invite-sponsor flow end to end** — highest priority, this is new and untested against real email delivery.
2. **Real click-through as owner + member test accounts** — still carried forward, now six sessions overdue.
3. **Weight-split decision** — same as v31/v32.
4. Pick one of: score history graph, shareable profile link, disclosure compliance check (the other three "real build" items from the mockup review).
5. Decide on 150/mo quota enforcement.
6. `notification_failures` table check.
7. Remaining Team-tier feature backlog.
