-- Repo-sync, not a new change: pulled verbatim from the live database
-- via Supabase MCP during a full trust/confidence calculation audit.
-- Same situation as 2026-07-19b-add-subscriber-count-and-twitch-engagement.sql
-- -- these had been applied directly to production and were live,
-- affecting real creators' scores, with no corresponding file in git.
--
-- 1. fn_recalc_engagement_quality_youtube -- superseded the flat-ratio
--    version in schema-baseline-2026-07-15.sql with a follower-count-
--    tiered version. The "good" views-per-video/subscriber ratio
--    compresses hard as a channel scales (a channel PewDiger's size
--    normally runs 0.2-0.5% views/subs and is perfectly healthy there --
--    ChannelCrawler 2025 / InfluenceFlow 2026 subscriber-to-view
--    benchmarks), so a single flat threshold across all channel sizes
--    systematically punished large, legitimately successful channels
--    and over-rewarded small ones riding a single viral hit.
--
-- 2. fn_recalc_engagement_quality_tiktok -- did not exist in git at
--    all. Included here already fixed (see
--    2026-07-27-fix-tiktok-engagement-normalization.sql for the bug
--    this replaces: the version that had been live divided lifetime
--    cumulative like_count directly by follower_count, with no
--    video_count normalization, unlike its YouTube sibling).
--
-- 3. creator_score_completeness -- superseded the baseline's
--    COUNT(*)-based version. Now normalizes by a fixed 5 (the 5 score
--    component families: engagement_quality, audience_authenticity,
--    content_consistency, professionalism, brand_safety) and dedupes
--    per-platform engagement_quality_youtube/_tiktok/_twitch keys via
--    regexp_replace so having a platform-specific component doesn't
--    inflate completeness differently depending on how many platforms
--    happen to be connected.
--
-- 4. fn_rebalance_component_family -- called by the platform-specific
--    engagement_quality_* trigger functions to split a family's total
--    weight (e.g. 0.20 for engagement_quality) evenly across however
--    many live_verified platform-specific components exist. Referenced
--    by name in 2026-07-19b's Twitch function since before that file
--    existed, but its own CREATE FUNCTION had never been committed.

CREATE OR REPLACE FUNCTION public.fn_rebalance_component_family(p_creator_id uuid, p_prefix text, p_total_weight numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  select count(*) into v_count
  from score_components
  where creator_id = p_creator_id
    and component_key like p_prefix || '\_%' escape '\'
    and status = 'live_verified';

  if v_count = 0 then
    return;
  end if;

  update score_components
  set weight = round(p_total_weight / v_count, 4), updated_at = now()
  where creator_id = p_creator_id
    and component_key like p_prefix || '\_%' escape '\'
    and status = 'live_verified';
end;
$function$;

CREATE OR REPLACE FUNCTION public.creator_score_completeness(p_creator_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT ROUND(
    COUNT(DISTINCT regexp_replace(component_key, '_youtube$', ''))
      FILTER (WHERE value IS NOT NULL AND value > 0)::NUMERIC
    / 5.0 * 100, 1
  )
  FROM score_components
  WHERE creator_id = p_creator_id;
$function$;

CREATE OR REPLACE FUNCTION public.fn_recalc_engagement_quality_youtube()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_ratio numeric;
  v_value numeric;
begin
  if new.follower_count is null or new.follower_count = 0
     or new.video_count is null or new.video_count = 0
     or new.view_count is null then
    return new;
  end if;

  v_ratio := (new.view_count::numeric / new.video_count) / new.follower_count;

  v_value := case
    when new.follower_count < 10000 then
      case when v_ratio >= 1.5  then 90
           when v_ratio >= 0.8  then 75
           when v_ratio >= 0.3  then 60
           when v_ratio >= 0.1  then 45
           else 30 end
    when new.follower_count < 100000 then
      case when v_ratio >= 0.5  then 90
           when v_ratio >= 0.25 then 75
           when v_ratio >= 0.10 then 60
           when v_ratio >= 0.04 then 45
           else 30 end
    when new.follower_count < 500000 then
      case when v_ratio >= 0.30  then 90
           when v_ratio >= 0.15  then 75
           when v_ratio >= 0.06  then 60
           when v_ratio >= 0.025 then 45
           else 30 end
    when new.follower_count < 2000000 then
      case when v_ratio >= 0.15  then 90
           when v_ratio >= 0.08  then 75
           when v_ratio >= 0.03  then 60
           when v_ratio >= 0.01  then 45
           else 30 end
    else
      case when v_ratio >= 0.05  then 90
           when v_ratio >= 0.02  then 75
           when v_ratio >= 0.008 then 60
           when v_ratio >= 0.003 then 45
           else 30 end
  end;

  insert into score_components (creator_id, component_key, label, weight, value, status)
  values (new.creator_id, 'engagement_quality_youtube', 'Engagement quality (YouTube)', 0.20, v_value, 'live_verified')
  on conflict (creator_id, component_key)
  do update set value = excluded.value, status = 'live_verified', updated_at = now();

  delete from score_components
  where creator_id = new.creator_id and component_key = 'engagement_quality';

  perform fn_rebalance_component_family(new.creator_id, 'engagement_quality', 0.20);

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_recalc_engagement_quality ON public.platform_connections;
DROP TRIGGER IF EXISTS trg_recalc_engagement_quality_youtube ON public.platform_connections;
CREATE TRIGGER trg_recalc_engagement_quality_youtube
  AFTER INSERT OR UPDATE OF follower_count, video_count, view_count ON public.platform_connections
  FOR EACH ROW
  WHEN (new.platform = 'youtube' AND new.verification_method = 'oauth')
  EXECUTE FUNCTION public.fn_recalc_engagement_quality_youtube();

DROP TRIGGER IF EXISTS trg_recalc_engagement_quality_tiktok ON public.platform_connections;
CREATE TRIGGER trg_recalc_engagement_quality_tiktok
  AFTER INSERT OR UPDATE ON public.platform_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_recalc_engagement_quality_tiktok();
