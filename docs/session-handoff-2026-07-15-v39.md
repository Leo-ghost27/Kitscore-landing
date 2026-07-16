# Session handoff — 2026-07-15 (v39)

Picks up from `session-handoff-2026-07-09-v38.md`. Six days, no handoff
written in between despite a lot of shipped work (including by at least
one other parallel session) — this doc exists to close that gap.

## Resolved since v38

- **Clean URLs work.** `/p/:slug` and `/ek/:slug` were an open,
  ten-plus-session-old mystery in v38. Root cause found 07-14:
  `cleanUrls: true` strips `.html` at build time, so `vercel.json`
  rewrite destinations pointing at `/app/p.html` never matched their
  own output. Fixed across `487fed5`, `021f02d`, `b3cdb0f`. Verified
  live via the Vercel connector on 07-15 — both routes return real 200s.
- **Stripe Price ID cross-check** — closed 07-13, see
  `docs/2026-07-13-stripe-price-id-crosscheck-resolved.md`.
- **Starter-plan eval quota race condition** — replaced 07-12 with an
  atomic `UPDATE ... WHERE evals_used_this_period < 25 ... RETURNING`
  claim (`fn_claim_free_eval_unlock`).

## Still open from v38 (unchanged, carrying forward)

- **Score component weights** are still flat 0.20 across all 5
  components. Normalized for consistency 07-10, but the actual
  business decision on differentiated weighting was never made.
- **CRON_SECRET** — not verifiable from this environment (Vercel env
  var); worth a manual check that it's set and the Monday
  evidence-nudge cron is actually firing.
- **Disclosure compliance** — explicitly on hold pending OAuth
  decisions, per prior call.
- **Real click-through QA as owner + team member** — no evidence this
  has happened since being flagged as overdue in v38.

## New feature work since v38 (all live)

EveKit (the creator media-kit page/PDF) picked up most of the attention
this window:

- Past collaborations, press mentions, available-for, and causes —
  DB tables/columns + on-screen rendering + PDF export
  (`484f432`, `5ca5d47`, `f0d6703`, `5a3432d`)
- Creator avatar + optional gallery images (`79ef5e8`)
- Multi-country/gender/age audience demographics, replacing a single
  flat breakdown (`9d8c86d`, `d0b8616`)
- Subscriber/follower + video + view counts per platform, consistent
  across owner view, public page, and PDF (`d61231d`)
- `content_consistency_youtube`: real posting cadence via OAuth,
  replacing the old self-reported version (`c0c9a42`)
- Color theme picker — 6 curated themes, instant preview + auto-save,
  reflected in the PDF export too (`ae8ea58`, `31f7bcc`, `7accb43`) —
  shipped by a parallel session same day as some of the above

## Bugs found and fixed during a full repo audit (07-15)

Not user-reported — found by directly comparing live Supabase state
against the repo and against two real test accounts
(`eve-hamza-7946c`, `fiona-r-fc271`):

1. **PDF generator was stale.** `lib/handlers/document-evekit.js`
   predated collaborations/press-mentions/available-for/causes by
   several days and never picked them up — they saved fine and
   rendered fine on-screen, just vanished on download. Fixed (`5a3432d`).
2. **`view_count` missing from the public RPC.** `fn_get_evekit_profile`
   forwarded `video_count` but not `view_count`. Fixed (`2026-07-14b`)
   — **then silently reverted the same day** when a parallel session's
   theme migration (`2026-07-15-evekit-theme-customization.sql`)
   recreated the same function from a spec that predated the fix.
   Caught and fixed again, this time merged with `theme`
   (`2026-07-15b-evekit-restore-view-count.sql`, `0181cfd`). **This is
   exactly the coordination risk `supabase/README.md` warns about** —
   two sessions independently `DROP + CREATE`-ing the same function
   with no lock or diff between them. Worth being deliberate about:
   check git log for a function's most recent migration before
   recreating it, not just what's live.
3. **Double-`@` in YouTube handles.** `@kitscoreco` was stored with
   the `@` already included; the render template added another one,
   showing `@@kitscoreco`. Fixed (`6d651c3`).
4. **Owner's own EveKit view hid connected platforms at 0 followers.**
   `loadOwnerKit`'s filter required `follower_count > 0`, not just
   `!= null` — so a genuinely connected, verified platform sitting at
   0 followers (new TikTok OAuth link, brand-new YouTube channel)
   disappeared entirely, with no way for the owner to even confirm the
   connection worked. Public page and PDF never had this bug (they
   only filtered out `null`). Fixed (`5de4e75`) — confirmed via live
   query this affected both real test accounts, not a one-off.

Also confirmed **not** a bug: the two test accounts showing different
EveKit sections. `fiona-r-fc271` genuinely has empty `available_for`/
`causes` and zero rows in `creator_collaborations`/
`creator_press_mentions` — those cards are correctly conditional on
data existing.

## Process debt addressed this session

- `supabase/schema-baseline-2026-07-04.sql` was 11 days stale (missing
  `creator_collaborations`, `creator_press_mentions`,
  `available_for`/`causes`/`theme` on `creators`, `view_count` on
  `platform_connections`, among others). Replaced with
  `schema-baseline-2026-07-15.sql`, generated directly from live
  `pg_proc`/`pg_trigger`/`pg_policy` rather than hand-assembled, to
  avoid transcription drift.
- This handoff doc itself — closes the six-day gap since v38.

## For next session

- Same open items as v38 (weights decision, CRON_SECRET check,
  disclosure compliance on hold, real click-through QA) — none of
  these moved.
- If another parallel session is active, check recent git log before
  running any `DROP FUNCTION` / recreate-style migration — bug #2
  above happened because two sessions each had a correct-at-the-time
  but incomplete picture of the same function.
- X/Twitter and Instagram connect flows remain unbuilt (Instagram is
  in the schema's platform list with no OAuth/lookup implementation;
  Twitch isn't in the schema at all). Scoped as new integration work,
  not touched this session.
