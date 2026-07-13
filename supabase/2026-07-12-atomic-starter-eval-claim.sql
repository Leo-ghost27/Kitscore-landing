-- 2026-07-12-atomic-starter-eval-claim.sql
--
-- Fixes a race condition in the Starter free-evaluation cap (25/period).
-- lib/handlers/billing-checkout.js previously did a separate SELECT to
-- read evals_used_this_period, decided free-vs-$12 in JS, then a separate
-- UPDATE to increment it. Two concurrent requests (double-click, two tabs)
-- on a sponsor's 25th evaluation could both read used=24, both decide
-- "free", and both increment -- one $12 charge silently skipped.
--
-- fn_claim_free_eval_unlock does the check-and-increment as a single
-- atomic UPDATE ... WHERE evals_used_this_period < 25 ... RETURNING.
-- Postgres row-level locking means only one concurrent caller can win the
-- update for a given sponsor row; the loser's WHERE clause simply matches
-- zero rows once the winner's write commits, so it correctly falls through
-- to the $12 charge instead of also getting a free unlock.

CREATE OR REPLACE FUNCTION public.fn_claim_free_eval_unlock(p_sponsor_id uuid)
 RETURNS TABLE(claimed boolean, new_used integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_used integer;
BEGIN
  UPDATE sponsors
  SET evals_used_this_period = evals_used_this_period + 1
  WHERE id = p_sponsor_id
    AND plan = 'starter'
    AND evals_used_this_period < 25
  RETURNING evals_used_this_period INTO v_new_used;

  IF v_new_used IS NOT NULL THEN
    RETURN QUERY SELECT true, v_new_used;
  ELSE
    RETURN QUERY SELECT false, NULL::integer;
  END IF;
END;
$function$;
