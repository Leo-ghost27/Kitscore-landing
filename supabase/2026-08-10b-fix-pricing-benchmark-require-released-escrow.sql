-- fn_pricing_benchmark existed live in production (used by app/dashboard.html
-- and app/contracts.html) but was never committed to this repo as a
-- migration -- this file both documents it retroactively and fixes a real
-- bug found during a pre-launch audit on 2026-08-10.
--
-- Bug: the function filtered on `escrow_amount_cents is not null and
-- status <> 'void'`, but escrow_amount_cents gets populated as soon as a
-- contract is drafted -- not only once escrow is actually funded and
-- released. Confirmed live: contracts existed with escrow_status =
-- 'not_funded' that still had escrow_amount_cents set, meaning an
-- unfunded, never-paid-out contract could count toward a benchmark
-- marketed everywhere as "real, funded Kitscore Escrow contracts" /
-- "settled deals." Fix: require escrow_status = 'released'.
--
-- Also worth knowing (not a bug, just current reality as of this audit):
-- there are only 4 contracts total in production, 1 of them released --
-- the function's own `having count(*) >= 3` means this will return no
-- rows for effectively everyone until more deals close on Kitscore. The
-- dashboard already has an honest "not enough data yet" fallback for
-- this (app/dashboard.html loadRealPricingBenchmark()), so nothing to
-- fix there -- just don't expect this to show real numbers to early
-- creators for a while.

CREATE OR REPLACE FUNCTION public.fn_pricing_benchmark(p_creator_id uuid)
 RETURNS TABLE(sample_size integer, min_cents integer, median_cents integer, max_cents integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with target as (
    select niche, trust_score from creators where id = p_creator_id
  ),
  comparable as (
    select c.escrow_amount_cents as amt
    from contracts c
    join creators cr on cr.id = c.creator_id
    join target t on true
    where c.escrow_amount_cents is not null
      and c.status <> 'void'
      and c.escrow_status = 'released'
      and cr.niche = t.niche
      and abs(cr.trust_score - t.trust_score) <= 15
  )
  select
    count(*)::integer,
    min(amt)::integer,
    percentile_cont(0.5) within group (order by amt)::integer,
    max(amt)::integer
  from comparable
  having count(*) >= 3;
$function$;
