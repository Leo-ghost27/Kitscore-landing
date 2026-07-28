-- 2026-07-27b-instagram-engagement-quality.sql
--
-- NOT YET LIVE. This function is written and ready, but cannot actually
-- fire yet -- it depends on data the current Instagram integration
-- doesn't fetch. Meta App Review for the `instagram_business_basic`
-- permission was submitted and is "Review in progress" as of writing
-- (typically ~20 days per Meta's own stated timeline). Once approved,
-- two things still need to happen before this scores anyone:
--
-- 1. lib/handlers/instagram-oauth-callback.js currently only stores
--    follower_count and media_count (confirmed by reading the file --
--    it maps user.followers_count and user.media_count and nothing
--    else). It needs to additionally call
--    GET /me/media?fields=like_count,comments_count&limit=25 (or
--    similar), average like_count+comments_count across the most
--    recent ~12-25 posts, and store the result. instagram_business_basic
--    is exactly the permission that exposes like_count/comments_count
--    per media object (confirmed against Meta's 2026 Graph API docs --
--    this is NOT covered by the old, deprecated Basic Display API,
--    which is why this required a fresh permission and a fresh review).
-- 2. platform_connections needs two new columns for this (added below
--    now, so the schema is ready the moment the callback is updated) --
--    avg_likes_per_post and avg_comments_per_post, kept separate from
--    the existing generic `like_count` column since that column is
--    TikTok's lifetime-cumulative figure, not directly comparable to
--    an Instagram recent-posts average.
--
-- Thresholds below: (avg likes + avg comments) / followers * 100,
-- tiered by follower count. Synthesized from eight independent 2026
-- sources (Buffer, Hootsuite/Socialinsider, IQFluence, InfluencerFee,
-- Virallized, CreatorFlow, InfluenceFlow, Nowadays Media) that
-- converge closely despite different methodologies -- all describe the
-- same inverted-U/declining-with-scale shape: nano ~4-10%, micro
-- ~1.5-6%, mid-tier ~1-4%, macro ~0.5-2.5%, mega ~0.4-2%. Bands set at
-- the median-to-upper end of each tier's range for the 90/75 scores,
-- median-to-lower end for 60/45, consistent with how the YouTube/TikTok
-- tiers in this same file were calibrated (matching a real worked
-- example to each threshold, not just picking round numbers).

ALTER TABLE platform_connections ADD COLUMN IF NOT EXISTS avg_likes_per_post numeric;
ALTER TABLE platform_connections ADD COLUMN IF NOT EXISTS avg_comments_per_post numeric;

CREATE OR REPLACE FUNCTION public.fn_recalc_engagement_quality_instagram()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_ratio numeric;
  v_value numeric;
begin
  if new.platform is distinct from 'instagram'
     or new.follower_count is null or new.follower_count = 0
     or new.avg_likes_per_post is null or new.avg_comments_per_post is null then
    return new;
  end if;

  v_ratio := ((new.avg_likes_per_post + new.avg_comments_per_post) / new.follower_count) * 100;

  v_value := case
    when new.follower_count < 10000 then
      case when v_ratio >= 8    then 90
           when v_ratio >= 5    then 75
           when v_ratio >= 3    then 60
           when v_ratio >= 1.2  then 45
           else 30 end
    when new.follower_count < 100000 then
      case when v_ratio >= 5    then 90
           when v_ratio >= 3    then 75
           when v_ratio >= 1.8  then 60
           when v_ratio >= 0.8  then 45
           else 30 end
    when new.follower_count < 500000 then
      case when v_ratio >= 3    then 90
           when v_ratio >= 1.8  then 75
           when v_ratio >= 1    then 60
           when v_ratio >= 0.5  then 45
           else 30 end
    when new.follower_count < 2000000 then
      case when v_ratio >= 2    then 90
           when v_ratio >= 1.2  then 75
           when v_ratio >= 0.6  then 60
           when v_ratio >= 0.3  then 45
           else 30 end
    else
      case when v_ratio >= 1.2  then 90
           when v_ratio >= 0.7  then 75
           when v_ratio >= 0.4  then 60
           when v_ratio >= 0.15 then 45
           else 30 end
  end;

  insert into score_components (creator_id, component_key, label, weight, value, status)
  values (new.creator_id, 'engagement_quality_instagram', 'Engagement quality (Instagram)', 0.20, v_value, 'live_verified')
  on conflict (creator_id, component_key)
  do update set value = excluded.value, status = 'live_verified', updated_at = now();

  delete from score_components
  where creator_id = new.creator_id and component_key = 'engagement_quality';

  perform fn_rebalance_component_family(new.creator_id, 'engagement_quality', 0.20);

  return new;
end;
$function$;

-- Trigger not created yet on purpose -- there's no point firing this on
-- every platform_connections write when avg_likes_per_post/
-- avg_comments_per_post will be null for every row until the OAuth
-- callback is updated to populate them. Add this once that's done:
--
-- CREATE TRIGGER trg_recalc_engagement_quality_instagram
--   AFTER INSERT OR UPDATE OF follower_count, avg_likes_per_post, avg_comments_per_post
--   ON platform_connections
--   FOR EACH ROW WHEN (new.platform = 'instagram' AND new.verification_method = 'oauth')
--   EXECUTE FUNCTION fn_recalc_engagement_quality_instagram();
