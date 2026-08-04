-- 2026-08-03-fix-engagement-quality-stale-weights.sql
--
-- The real, currently-active cause of the Trust Score weighting looking
-- like it "keeps changing back" -- not repeated flip-flopping by
-- different sessions, one specific incomplete fix that keeps
-- reasserting itself on a schedule.
--
-- The 2026-08-01 rebalance correctly updated fn_recalc_engagement_quality_
-- youtube (and tiktok, already correct) to the new 30% total weight, but
-- MISSED fn_recalc_engagement_quality_instagram, _twitch, and _discord --
-- all three still hardcoded the pre-rebalance 20%. Because
-- fn_rebalance_component_family divides whatever p_total_weight it's
-- given across EVERY engagement_quality_* row a creator has (not just
-- the platform that triggered it), any one of these three stale
-- functions firing overwrites a creator's ALREADY-CORRECT YouTube/TikTok
-- weight back down too. The Discord message-engagement poll runs daily
-- (see app/admin-system.html scheduled jobs) -- so any creator with
-- Discord connected gets silently re-corrupted once a day, which is
-- almost certainly why this has looked unresolved across multiple
-- sessions: the fix was never actually complete, so it keeps undoing
-- itself on schedule, not being actively reverted by anyone.
--
-- Confirmed via data: Eve Hamza (youtube+discord both connected) had
-- both weights sitting at 0.10 (0.20 stale total / 2 platforms) as of
-- today, despite her YouTube weight having been correctly set to 0.30
-- at some point -- overwritten by the next Discord poll run. Sia
-- Martin (discord only) sat at 0.20 (0.20 stale total / 1 platform).
--
-- This migration: (1) fixes all three stale functions to the correct
-- 30% total, matching youtube/tiktok, (2) retroactively re-rebalances
-- every creator's engagement_quality_* family to 30% total regardless
-- of which platform combination they have, which also recalculates
-- trust_score automatically via the existing trg_recalc_trust_score
-- trigger (fires on UPDATE OF weight).
--
-- Applied directly to Supabase (project tpcriphrfrrgywycviqv) via the
-- Supabase MCP apply_migration tool on 2026-08-03; this file is the git
-- record of that change per supabase/README.md's practice. Verified
-- live after applying: Sia Martin (1 platform) -> 0.30, Eve Hamza
-- (2 platforms) -> 0.15 each, all single-platform YouTube creators ->
-- 0.30. Confirmed no 'professionalism' function, trigger, or data row
-- remains anywhere in the system -- that part of the July 7 -> Aug 1
-- change was fully and correctly completed; this fix was a separate,
-- previously-undiscovered gap in the same rebalance effort.

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
  values (new.creator_id, 'engagement_quality_instagram', 'Engagement quality (Instagram)', 0.30, v_value, 'live_verified')
  on conflict (creator_id, component_key)
  do update set value = excluded.value, status = 'live_verified', updated_at = now();

  delete from score_components
  where creator_id = new.creator_id and component_key = 'engagement_quality';

  perform fn_rebalance_component_family(new.creator_id, 'engagement_quality', 0.30);

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_recalc_engagement_quality_twitch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ratio numeric;
  v_value numeric;
begin
  if new.platform is distinct from 'twitch' then
    return new;
  end if;

  if new.follower_count is null or new.follower_count = 0 or new.subscriber_count is null then
    return new;
  end if;

  v_ratio := (new.subscriber_count::numeric / new.follower_count) * 100;

  v_value := case
    when v_ratio >= 5   then 90
    when v_ratio >= 3   then 78
    when v_ratio >= 1.5 then 65
    when v_ratio >= 0.5 then 50
    else 35
  end;

  insert into score_components (creator_id, component_key, label, weight, value, status)
  values (new.creator_id, 'engagement_quality_twitch', 'Engagement quality (Twitch)', 0.30, v_value, 'live_verified')
  on conflict (creator_id, component_key)
  do update set value = excluded.value, status = 'live_verified', updated_at = now();

  delete from score_components
  where creator_id = new.creator_id and component_key = 'engagement_quality';

  perform fn_rebalance_component_family(new.creator_id, 'engagement_quality', 0.30);

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_recalc_engagement_quality_discord()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_value numeric;
begin
  if new.platform is distinct from 'discord'
     or new.avg_messages_per_member is null then
    return new;
  end if;

  v_value := case
    when new.avg_messages_per_member >= 4    then 90
    when new.avg_messages_per_member >= 2    then 70
    when new.avg_messages_per_member >= 1    then 55
    when new.avg_messages_per_member >= 0.3  then 40
    else 25
  end;

  insert into score_components (creator_id, component_key, label, weight, value, status)
  values (new.creator_id, 'engagement_quality_discord', 'Engagement quality (Discord)', 0.30, v_value, 'live_verified')
  on conflict (creator_id, component_key)
  do update set value = excluded.value, status = 'live_verified', updated_at = now();

  delete from score_components
  where creator_id = new.creator_id and component_key = 'engagement_quality';

  perform fn_rebalance_component_family(new.creator_id, 'engagement_quality', 0.30);

  return new;
end;
$function$;

-- Retroactively fix every creator currently sitting at a stale weight.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT creator_id FROM score_components WHERE component_key LIKE 'engagement\_quality\_%' ESCAPE '\'
  LOOP
    PERFORM fn_rebalance_component_family(r.creator_id, 'engagement_quality', 0.30);
  END LOOP;
END $$;
