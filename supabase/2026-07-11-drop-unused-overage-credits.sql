-- Cleanup: overage_credits (added in 2026-07-11-starter-overage-credits.sql)
-- was a parallel-session implementation of the Starter cap that was
-- superseded same-day by a different, simpler design already built and
-- shipped in this same window: sponsors.evals_used_this_period +
-- sponsors.period_start, reset via the invoice.paid Stripe webhook
-- (see supabase/2026-07-11-starter-eval-cap.sql). overage_credits was
-- never wired into the shipped cap-check logic and had zero real usage --
-- dropping it rather than leaving an orphaned, confusing column.
ALTER TABLE public.sponsors DROP COLUMN IF EXISTS overage_credits;
