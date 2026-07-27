-- Bug fix, applied directly to production during a full trust/confidence
-- calculation audit across YouTube/TikTok/Twitch/Instagram/Discord.
--
-- fn_recalc_engagement_quality_tiktok divided lifetime cumulative
-- like_count directly by follower_count, with no video_count
-- normalization -- unlike its YouTube sibling, which correctly averages
-- per video before comparing to followers. That meant a creator who's
-- posted 500 videos would out-score an equally-engaging creator who's
-- posted 20, purely on volume of posting history, not engagement
-- quality. Fixed to match YouTube's pattern: avg likes per video, then
-- as a % of followers.
--
-- Thresholds also recalibrated, since the ratio scale changed
-- completely (dividing by video_count on top of follower_count shrinks
-- it by 1-2 orders of magnitude vs the old lifetime-cumulative number).
-- Caveat worth being honest about: TikTok's own API scope
-- (user.info.stats) only returns likes -- no comments, shares, or view
-- counts -- so this is a likes-only, follower-denominator metric.
-- Published 2026 TikTok engagement benchmarks (Influencer Marketing
-- Factory, SociaVault, Dash Social) all measure
-- (likes+comments+shares)/views, and disagree with each other by 2-4x
-- depending on methodology, so none of them transfer directly to what
-- we can actually compute here. These bands are anchored loosely to
-- Instagram's likes+comments/followers 2026 benchmarks (Nowadays
-- Media: ~0.98% overall, nano 3.5-6%, micro 1.5-3.5%) -- the closest
-- same-denominator published analog -- with a modest upward
-- adjustment, since TikTok's distribution algorithm reliably pushes
-- content beyond a creator's follower base more than Instagram's does,
-- so likes-per-follower tends to run measurably higher on TikTok even
-- measured this way. Treat as directional, not precise -- revisit if
-- TikTok ever exposes view-level data to this scope.
CREATE OR REPLACE FUNCTION public.fn_recalc_engagement_quality_tiktok()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_avg_likes_per_video numeric;
  v_ratio numeric;
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

-- Re-fire for existing connections so the fix applies immediately
-- rather than waiting for the next resync/reconnect.
UPDATE public.platform_connections SET updated_at = now() WHERE platform = 'tiktok';
