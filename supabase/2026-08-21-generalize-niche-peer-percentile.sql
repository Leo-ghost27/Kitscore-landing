-- 2026-08-21-generalize-niche-peer-percentile.sql
--
-- fn_niche_peer_percentile took p_platform and always compared
-- component_key = 'engagement_quality_'||p_platform -- engagement
-- quality only. Generalized to take p_component_key directly so
-- "How you compare" on the Score tab can also show audience
-- authenticity peer percentile, added as the one metric beyond
-- engagement quality worth benchmarking here: fake-follower/audience
-- authenticity detection is the baseline trust check sponsors and the
-- industry weigh most (see e.g. HypeAuditor's whole business model).
-- Deliberately kept to just this one component, not a full
-- benchmarking suite, per Gina -- free tier already offers plenty.
--
-- Two call sites updated to match: dashboard.html's Signals-tab
-- per-platform engagement breakdown (dash.nicheBenchmarks) and the
-- Score tab's "How you compare" card (dash.peerPercentiles). Both now
-- pass the full component_key.
--
-- Applied live via the Supabase MCP apply_migration tool; this file
-- is the git record.

DROP FUNCTION public.fn_niche_peer_percentile(uuid, text);

CREATE FUNCTION public.fn_niche_peer_percentile(p_creator_id uuid, p_component_key text)
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
  where sc.creator_id = p_creator_id and sc.component_key = p_component_key;

  if v_my_value is null then
    return;
  end if;

  select count(*) into v_cohort_size
  from score_components sc
  join creators c on c.id = sc.creator_id
  where sc.component_key = p_component_key
    and lower(trim(c.niche)) = v_niche;

  if v_cohort_size < v_min_cohort then
    return query select null::numeric, v_cohort_size, v_niche;
    return;
  end if;

  select count(*) into v_rank
  from score_components sc
  join creators c on c.id = sc.creator_id
  where sc.component_key = p_component_key
    and lower(trim(c.niche)) = v_niche
    and sc.value <= v_my_value;

  return query select round((v_rank::numeric / v_cohort_size) * 100, 0), v_cohort_size, v_niche;
end;
$function$;
