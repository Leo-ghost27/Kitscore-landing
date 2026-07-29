-- fn_niche_engagement_benchmark, renamed to fn_niche_peer_percentile.
--
-- Found live and completely undocumented during this session's review:
-- no matching file anywhere in supabase/, not wired into any UI. Same
-- "applied live, never committed" gap the README already warns about
-- (see 2026-07-27-sync-tiered-engagement-and-completeness.sql for the
-- earlier instance of this exact pattern).
--
-- Reviewed against fn_niche_engagement_mult (this session's own
-- niche-adjusted SCORE fix, folded into
-- fn_recalc_engagement_quality_youtube/tiktok in
-- 2026-07-28-brand-safety-and-niche-engagement.sql) -- confirmed these
-- are complementary, not duplicates, despite the near-identical name
-- that caused real confusion when first found:
--
--   fn_niche_engagement_mult  -- changes the actual engagement_quality
--                                SCORE, using fixed external industry
--                                benchmarks (8 niches). Works for every
--                                creator immediately, no cohort needed.
--
--   fn_niche_peer_percentile  -- read-only, does NOT touch the score.
--                                Real percentile rank against actual
--                                same-niche, same-platform creators on
--                                Kitscore itself. Requires >=5 real
--                                peers (v_min_cohort) or honestly
--                                returns cohort_size with a null
--                                percentile rather than faking
--                                precision off too few data points.
--
-- Renamed rather than removed: "addresses a similar-sounding thing" is
-- not the same as "does the same thing" -- one fixes whether the score
-- itself is fair today, the other adds honest additional context once
-- real peer density exists. Renamed because the ORIGINAL name (one
-- word: engagement_benchmark vs engagement_mult) was doing real harm
-- on its own, independent of what the functions actually do -- the
-- name should signal the distinction, not require re-deriving it from
-- the function bodies every time someone runs into both.
DROP FUNCTION IF EXISTS public.fn_niche_engagement_benchmark(uuid, text);

CREATE OR REPLACE FUNCTION public.fn_niche_peer_percentile(p_creator_id uuid, p_platform text)
 RETURNS TABLE(percentile numeric, cohort_size integer, niche text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_niche text;
  v_my_value numeric;
  v_cohort_size integer;
  v_rank integer;
  v_min_cohort constant integer := 5;
begin
  select lower(trim(c.niche)) into v_niche from creators c where c.id = p_creator_id;
  if v_niche is null or v_niche = '' then
    return;
  end if;

  select sc.value into v_my_value
  from score_components sc
  where sc.creator_id = p_creator_id and sc.component_key = 'engagement_quality_' || p_platform;

  if v_my_value is null then
    return;
  end if;

  select count(*) into v_cohort_size
  from score_components sc
  join creators c on c.id = sc.creator_id
  where sc.component_key = 'engagement_quality_' || p_platform
    and lower(trim(c.niche)) = v_niche;

  if v_cohort_size < v_min_cohort then
    return query select null::numeric, v_cohort_size, v_niche;
    return;
  end if;

  select count(*) into v_rank
  from score_components sc
  join creators c on c.id = sc.creator_id
  where sc.component_key = 'engagement_quality_' || p_platform
    and lower(trim(c.niche)) = v_niche
    and sc.value <= v_my_value;

  return query select round((v_rank::numeric / v_cohort_size) * 100, 0), v_cohort_size, v_niche;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_niche_peer_percentile(uuid, text) TO authenticated;
