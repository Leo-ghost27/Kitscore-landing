-- Adds Starter plan's included-evaluations tracking.
-- evals_used_this_period: count of evaluations unlocked free under the
--   Starter plan's 25/period allowance. Reset to 0 by the invoice.paid
--   webhook handler on each successful renewal (see api/stripe-webhook.js).
-- period_start: when the current count started, for display/debugging
--   ("used 18 of 25 since July 3") — not used for the cap check itself,
--   which just compares evals_used_this_period against 25 directly.
--
-- Both default to values that are safe for existing rows: 0 used, and
-- period_start defaults to now() so nothing looks like it's mid-period
-- with no start date on backfill.

alter table sponsors
  add column if not exists evals_used_this_period integer not null default 0;

alter table sponsors
  add column if not exists period_start timestamptz not null default now();
