-- Fixes two gaps found during a marketing-vs-product accuracy audit
-- (methodology.html and for-creators.html were both promising things
-- the live product didn't actually do -- see chat for full findings).

-- ── 1. Brand safety: the missing 3 of 8 ──────────────────────────────────
-- brand_safety_penalties already had fully-costed rows for
-- paid_disclosure, misinformation, and controversy_history -- the
-- backend was built (2026-07-13 design discussion is referenced
-- directly in fn_admin_apply_brand_safety_scan's comments) but the
-- creator-facing questionnaire (dashboard.html QUESTIONS array) was
-- never updated to actually ask them. fn_recalc_brand_safety already
-- sums penalties for whatever question_keys exist in
-- brand_safety_answers, so no scoring-function change is needed here --
-- only casing needs normalizing to match the Title Case convention the
-- other 5 questions use (dashboard.html renders `answer` values
-- directly as button text). Confirmed zero existing brand_safety_answers
-- rows use these question_keys, so this is a pure rename, not a data
-- migration.
UPDATE public.brand_safety_penalties SET answer = 'Always' WHERE question_key = 'paid_disclosure' AND answer = 'always';
UPDATE public.brand_safety_penalties SET answer = 'Inconsistent' WHERE question_key = 'paid_disclosure' AND answer = 'inconsistent';
UPDATE public.brand_safety_penalties SET answer = 'Never' WHERE question_key = 'paid_disclosure' AND answer = 'never';

UPDATE public.brand_safety_penalties SET answer = 'None' WHERE question_key = 'misinformation' AND answer = 'none';
UPDATE public.brand_safety_penalties SET answer = 'Suspected' WHERE question_key = 'misinformation' AND answer = 'suspected';
UPDATE public.brand_safety_penalties SET answer = 'Confirmed' WHERE question_key = 'misinformation' AND answer = 'confirmed';

UPDATE public.brand_safety_penalties SET answer = 'None' WHERE question_key = 'controversy_history' AND answer = 'none';
UPDATE public.brand_safety_penalties SET answer = 'Minor' WHERE question_key = 'controversy_history' AND answer = 'minor';
UPDATE public.brand_safety_penalties SET answer = 'Major' WHERE question_key = 'controversy_history' AND answer = 'major';

-- ── 2. Engagement quality: real niche benchmarking ───────────────────────
-- methodology.html and for-creators.html both claim engagement is
-- "benchmarked against category averages" (with a specific fitness-vs-
-- general-average example) -- what was actually live only banded by
-- follower-count tier, with no niche dimension at all. A prior,
-- unrelated attempt at category benchmarking (fn_engagement_benchmark,
-- percentile-vs-cohort) was built, never wired into any UI, and was
-- removed as orphaned dead code earlier this session at the user's
-- explicit direction -- this is a deliberately different, smaller
-- mechanism, not a revival of that one.
--
-- Reuses the exact same 8 niche keys as dashboard.html's
-- NICHE_RATE_MULT (finance/health/sustainability/tech/beauty/fashion/
-- lifestyle/fitness) for one consistent taxonomy across the product,
-- rather than inventing a second niche vocabulary. Directionally
-- sourced from 2026 industry engagement-rate-by-niche data (IQFluence,
-- SociaVault, Nowadays Media, creatorflow.so -- cross-checked, sources
-- disagree by 2-4x on absolute numbers same as the existing rate-card
-- comment already notes for $ benchmarks, so only the DIRECTION and
-- rough magnitude is treated as reliable): finance and tech consistently
-- run well below the cross-niche average; fitness consistently runs
-- above it; the rest cluster close to baseline. A niche outside this
-- set (or blank) gets a neutral 1.0 multiplier -- i.e. compared to the
-- general average, exactly as before -- rather than guessing.
--
-- Mechanism: effective_ratio = raw_ratio / niche_mult, then banded
-- against the SAME thresholds as before. A fitness creator (mult 1.20)
-- needs a higher raw ratio to hit the same score a baseline creator
-- would; a finance creator (mult 0.60) needs less. This is a real
-- change in scored outcomes for creators in these 8 niches, not just a
-- label -- creators may see their engagement_quality component value
-- shift after this deploys.

CREATE OR REPLACE FUNCTION public.fn_niche_engagement_mult(p_niche text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE lower(coalesce(p_niche, ''))
    WHEN 'finance' THEN 0.60
    WHEN 'tech' THEN 0.65
    WHEN 'sustainability' THEN 0.85
    WHEN 'health' THEN 0.90
    WHEN 'fashion' THEN 0.95
    WHEN 'beauty' THEN 1.00
    WHEN 'lifestyle' THEN 1.00
    WHEN 'fitness' THEN 1.20
    ELSE 1.00
  END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_recalc_engagement_quality_youtube()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_ratio numeric;
  v_niche_mult numeric;
  v_value numeric;
begin
  if new.follower_count is null or new.follower_count = 0
     or new.video_count is null or new.video_count = 0
     or new.view_count is null then
    return new;
  end if;

  v_ratio := (new.view_count::numeric / new.video_count) / new.follower_count;
  v_niche_mult := fn_niche_engagement_mult((select niche from creators where id = new.creator_id));
  v_ratio := v_ratio / v_niche_mult;

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

CREATE OR REPLACE FUNCTION public.fn_recalc_engagement_quality_tiktok()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_avg_likes_per_video numeric;
  v_ratio numeric;
  v_niche_mult numeric;
  v_value numeric;
begin
  if new.platform is distinct from 'tiktok'
     or new.follower_count is null or new.follower_count = 0
     or new.video_count is null or new.video_count = 0
     or new.like_count is null then
    return new;
  end if;

  v_avg_likes_per_video := new.like_count::numeric / new.video_count;
  v_ratio := (v_avg_likes_per_video / new.follower_count) * 100;
  v_niche_mult := fn_niche_engagement_mult((select niche from creators where id = new.creator_id));
  v_ratio := v_ratio / v_niche_mult;

  v_value := case
    when new.follower_count < 10000 then
      case when v_ratio >= 10   then 90
           when v_ratio >= 6    then 75
           when v_ratio >= 3    then 60
           when v_ratio >= 1.2  then 45
           else 30 end
    when new.follower_count < 100000 then
      case when v_ratio >= 7    then 90
           when v_ratio >= 4    then 75
           when v_ratio >= 2    then 60
           when v_ratio >= 0.8  then 45
           else 30 end
    when new.follower_count < 500000 then
      case when v_ratio >= 4    then 90
           when v_ratio >= 2.2  then 75
           when v_ratio >= 1    then 60
           when v_ratio >= 0.4  then 45
           else 30 end
    else
      case when v_ratio >= 2    then 90
           when v_ratio >= 1    then 75
           when v_ratio >= 0.5  then 60
           when v_ratio >= 0.2  then 45
           else 30 end
  end;

  insert into score_components (creator_id, component_key, label, weight, value, status)
  values (new.creator_id, 'engagement_quality_tiktok', 'Engagement quality (TikTok)', 0.20, v_value, 'live_verified')
  on conflict (creator_id, component_key)
  do update set value = excluded.value, status = 'live_verified', updated_at = now();

  delete from score_components
  where creator_id = new.creator_id and component_key = 'engagement_quality';

  perform fn_rebalance_component_family(new.creator_id, 'engagement_quality', 0.20);

  return new;
end;
$function$;

-- Re-fire for every existing connection with the data these functions
-- need, so the fix (and any score change from it) applies immediately
-- rather than waiting for the next resync/reconnect -- same pattern as
-- the 2026-07-27 TikTok normalization fix.
UPDATE public.platform_connections SET updated_at = now()
WHERE (platform = 'youtube' AND verification_method = 'oauth') OR platform = 'tiktok';
