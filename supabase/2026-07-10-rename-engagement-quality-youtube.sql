-- 2026-07-10-rename-engagement-quality-youtube.sql
--
-- Prep for a TikTok engagement_quality component (see
-- docs/tiktok-engagement-quality-pending.md for design status). Renames
-- the existing YouTube-only component from the generic 'engagement_quality'
-- key to 'engagement_quality_youtube' so TikTok can get its own
-- 'engagement_quality_tiktok' key later without colliding on the same row
-- (component_key is unique per creator via the upsert ON CONFLICT).
--
-- No formula change -- same reach-efficiency ratio (avg views per video,
-- relative to subscriber count), same 0.20 weight, same trigger condition
-- (platform = 'youtube' AND verification_method = 'oauth'). Existing rows
-- are renamed in place so no creator's trust_score changes as a result of
-- this migration.
--
-- IMPORTANT / NOT YET RESOLVED: all 5 score components (audience_
-- authenticity, engagement_quality_youtube, brand_safety,
-- content_consistency, professionalism) are weighted 0.20 each, summing to
-- exactly 1.00. fn_recalc_trust_score() sums value*weight across whatever
-- rows exist with NO renormalization. Adding engagement_quality_tiktok as a
-- straight 6th component at 0.20 would let trust_score exceed 100 for any
-- creator with both platforms connected. This must be resolved (either a
-- shared weight budget between the two engagement_quality_* keys, or a
-- full weight rebalance to 1/6 each) before a TikTok trigger is written --
-- see the pending doc.

-- ── 1. Rename existing rows (no value/weight change) ────────────────────
UPDATE public.score_components
SET component_key = 'engagement_quality_youtube',
    label = 'Engagement quality (YouTube)',
    updated_at = now()
WHERE component_key = 'engagement_quality';

-- ── 2. Recreate the function under the new key, same formula ────────────
DROP TRIGGER IF EXISTS trg_recalc_engagement_quality ON public.platform_connections;
DROP FUNCTION IF EXISTS public.fn_recalc_engagement_quality();

CREATE OR REPLACE FUNCTION public.fn_recalc_engagement_quality_youtube()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
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
    when v_ratio >= 1.0  then 90
    when v_ratio >= 0.5  then 80
    when v_ratio >= 0.2  then 70
    when v_ratio >= 0.05 then 55
    else 40
  end;

  insert into score_components (creator_id, component_key, label, weight, value, status)
  values (new.creator_id, 'engagement_quality_youtube', 'Engagement quality (YouTube)', 0.20, v_value, 'live_verified')
  on conflict (creator_id, component_key)
  do update set value = excluded.value, weight = excluded.weight, status = 'live_verified', updated_at = now();

  return new;
end;
$function$;

CREATE TRIGGER trg_recalc_engagement_quality_youtube
  AFTER INSERT OR UPDATE OF follower_count, video_count, view_count
  ON public.platform_connections
  FOR EACH ROW
  WHEN (NEW.platform = 'youtube' AND NEW.verification_method = 'oauth')
  EXECUTE FUNCTION public.fn_recalc_engagement_quality_youtube();
