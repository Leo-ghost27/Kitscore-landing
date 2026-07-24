-- Backfill: applied directly to the live database on 2026-07-19
-- (Supabase migration history: version 20260719094108, name
-- "add_subscriber_count_and_twitch_engagement") but never committed to
-- this repo. SQL below is pulled verbatim from
-- supabase_migrations.schema_migrations.
--
-- Adds Twitch's subscriber_count column and the engagement_quality_twitch
-- scoring trigger -- real scoring logic that has been live and affecting
-- creators' scores with no corresponding file in git until now.

ALTER TABLE public.platform_connections ADD COLUMN subscriber_count bigint;
COMMENT ON COLUMN public.platform_connections.subscriber_count IS 'Paid subscriber count (Twitch channel:read:subscriptions). NULL for non-Affiliate/Partner channels, which do not have subscriptions at all -- not the same as zero.';

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

  -- subscriber_count is NULL (not 0) for non-Affiliate/Partner channels --
  -- they have no subscription program at all, so there's nothing to
  -- score here yet. Leave the component untouched/absent rather than
  -- scoring a channel down for a monetization tier it hasn't reached.
  if new.follower_count is null or new.follower_count = 0 or new.subscriber_count is null then
    return new;
  end if;

  -- Subscriber-to-follower ratio, as a percentage. Real industry
  -- reference point (SocialTradia subscriber benchmarks, 2025-2026):
  -- established channels typically convert 1-3% of followers to paid
  -- subscribers. This is thinner data than the YouTube/TikTok tiers
  -- (single reference range, not a full distribution by channel size),
  -- so bands are wider and more conservative here on purpose.
  v_ratio := (new.subscriber_count::numeric / new.follower_count) * 100;

  v_value := case
    when v_ratio >= 5   then 90
    when v_ratio >= 3   then 78
    when v_ratio >= 1.5 then 65
    when v_ratio >= 0.5 then 50
    else 35
  end;

  insert into score_components (creator_id, component_key, label, weight, value, status)
  values (new.creator_id, 'engagement_quality_twitch', 'Engagement quality (Twitch)', 0.20, v_value, 'live_verified')
  on conflict (creator_id, component_key)
  do update set value = excluded.value, status = 'live_verified', updated_at = now();

  delete from score_components
  where creator_id = new.creator_id and component_key = 'engagement_quality';

  perform fn_rebalance_component_family(new.creator_id, 'engagement_quality', 0.20);

  return new;
end;
$function$;

CREATE TRIGGER trg_recalc_engagement_quality_twitch
  AFTER INSERT OR UPDATE ON public.platform_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_recalc_engagement_quality_twitch();
