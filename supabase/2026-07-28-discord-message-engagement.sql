-- 2026-07-28-discord-message-engagement.sql
--
-- Discord engagement scoring, built on a real bot (message-read access),
-- not the plain OAuth login the rest of this integration uses. As
-- discussed with the user: Discord has no REST endpoint for "give me
-- total message volume for this server" -- the only way to measure
-- actual activity (not just member count) is to have a bot look at
-- real messages. Kitscore runs on Vercel (serverless, no persistent
-- Gateway connection), so this is the "lighter, polling" version we
-- agreed on: a daily cron job samples recent message history via REST
-- rather than keeping a permanent Gateway connection open. Less
-- precise than true real-time tracking, but needs no new hosting.
--
-- Honesty note on calibration: unlike YouTube/TikTok/Instagram, where
-- multiple 2026 sources gave rich follower-tiered benchmark data,
-- Discord community-engagement research only turned up ONE solid
-- published anchor point: "messages per member above 4 is healthy"
-- (CommunityOne's community engagement benchmarks). The bands below
-- are built around that single point, not cross-verified against
-- several tiered sources the way the other platforms' thresholds were.
-- Treat this as a reasonable first pass, not equally rigorous.

ALTER TABLE platform_connections ADD COLUMN IF NOT EXISTS guild_id text;
ALTER TABLE platform_connections ADD COLUMN IF NOT EXISTS avg_messages_per_member numeric;
ALTER TABLE platform_connections ADD COLUMN IF NOT EXISTS message_sample_size integer;
ALTER TABLE platform_connections ADD COLUMN IF NOT EXISTS message_poll_error text;

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
  values (new.creator_id, 'engagement_quality_discord', 'Engagement quality (Discord)', 0.20, v_value, 'live_verified')
  on conflict (creator_id, component_key)
  do update set value = excluded.value, status = 'live_verified', updated_at = now();

  delete from score_components
  where creator_id = new.creator_id and component_key = 'engagement_quality';

  perform fn_rebalance_component_family(new.creator_id, 'engagement_quality', 0.20);

  return new;
end;
$function$;

CREATE TRIGGER trg_recalc_engagement_quality_discord
  AFTER INSERT OR UPDATE OF avg_messages_per_member
  ON platform_connections
  FOR EACH ROW WHEN (new.platform = 'discord' AND new.verification_method = 'oauth')
  EXECUTE FUNCTION fn_recalc_engagement_quality_discord();
