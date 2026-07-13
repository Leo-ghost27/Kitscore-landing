# Stripe Price ID cross-check — RESOLVED (2026-07-13)

Closing out the item that's been open since 2026-07-03 (first flagged in
`session-handoff-2026-07-03-v13.md`, repeated unresolved through
v14/v15/v20/v21/v22/v22-consolidated/v23/v24): **"Stripe live Price ID
cross-check — still the one nobody has done."**

## What was checked

Gina manually cross-checked every live Stripe Price ID against its
corresponding Vercel env var:

- `STRIPE_PRICE_REPORT` (On Demand, $29) — fixed 2026-07-06 (v22), was
  pointing at a deleted Price ID; confirmed still correct
- `STRIPE_PRICE_STARTER` ($99/mo) — confirmed correct
- `STRIPE_PRICE_TEAM` ($299/mo) — confirmed correct
- `STRIPE_PRICE_CREATOR_PRO` ($19.99/mo) — confirmed correct
- `STRIPE_PRICE_EVALUATION_UNLOCK` — deliberately unset (falls back to
  `STRIPE_PRICE_REPORT`, $29) — see note below, this was a same-session fix
- `STRIPE_PRICE_STARTER_OVERAGE` ($12) — newly created and wired this
  session, see below

One naming inconsistency noted and confirmed harmless: the Stripe product
behind `STRIPE_PRICE_REPORT` is named "On Demand" in Stripe, not "Report."
Only the Price ID is referenced anywhere in code — the product/price
nickname is Stripe-dashboard-only and isn't surfaced to sponsors. Actually
more consistent than the env var name suggests: the site itself calls this
tier "On Demand" everywhere (`app/pricing.html`, `index.html`), so Stripe's
naming matches what a sponsor sees, not the internal env var name.

## Related work completed same session (2026-07-13)

- Created the `$12` Starter-overage Stripe product/price, added NY sales
  tax registration, wired `STRIPE_PRICE_STARTER_OVERAGE`
- Found and fixed a real bug in the process: `STRIPE_PRICE_EVALUATION_UNLOCK`
  had been set to the new $12 price, but that env var actually feeds the
  **on-demand single-report unlock flow** (`evaluate.html`'s `unlock()`),
  which should be $29 — not the Starter-cap overage. Deleted that env var
  so it falls back to `STRIPE_PRICE_REPORT` ($29) as intended; added
  `STRIPE_PRICE_STARTER_OVERAGE` separately for the actual $12 flow.
- Fixed `evaluate.html`'s Unlock button, which hardcoded "$29" for every
  sponsor regardless of plan — now shows free/$12/$29 correctly per
  `billing-checkout.js`'s actual charge logic.
- Fixed a race condition in the Starter free-eval cap (see
  `supabase/2026-07-12-atomic-starter-eval-claim.sql`) — atomic claim
  function instead of a read-then-write pair.

**Status: closed.** Future sessions reading old handoff docs (v13–v24)
should treat the "Stripe live Price ID cross-check" line item as done —
this doc supersedes those.
