-- Bug fix, applied directly to production during a full trust/confidence
-- calculation audit. Also syncs fn_apply_audience_authenticity and
-- fn_recalc_audience_authenticity into git for the first time -- this
-- whole system existed live with no corresponding file in git.
--
-- fn_apply_audience_authenticity's per-platform plausibility loop only
-- ever checked youtube/tiktok/twitch. An Instagram-only connection
-- still set v_has_platform = true, which alone was enough to earn a
-- 75-95 "live_verified" audience_authenticity score -- meaning
-- Instagram was labeled as verified while literally nothing was ever
-- checked, unlike the three other platforms which get real scrutiny.
--
-- We don't have engagement data for Instagram (instagram_business_basic
-- scope returns follower_count and media_count only, no likes/comments),
-- so we can't replicate the engagement-ratio check the other three
-- platforms get. But follower_count vs. media_count is a real, commonly
-- used purchased-followers signal on its own: a large following with
-- almost no posting history is a classic pattern, because organic
-- follower growth normally requires actually having posted content.
-- Thresholds kept deliberately narrow (matching the "only flag
-- genuinely implausible cases" reasoning already used for Twitch) to
-- avoid false-flagging a legitimately new or fast-growing account.
--
-- Note: media_count is NULL on every Instagram connection made before
-- this migration (see 2026-07-27-add-instagram-media-count.sql) -- this
-- check only takes effect for those creators on their next
-- reconnect/resync, since there's no Instagram cron resync job yet to
-- backfill it automatically.
CREATE OR REPLACE FUNCTION public.fn_apply_audience_authenticity(p_creator_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_red_flag boolean := false;
  v_has_platform boolean;
  v_evidence_count integer;
  v_value numeric;
  v_ratio numeric;
  v_already_flagged boolean;
  r record;
begin
  select exists(select 1 from platform_connections where creator_id = p_creator_id) into v_has_platform;

  for r in
    select platform, follower_count, video_count, view_count, like_count, subscriber_count, media_count
    from platform_connections
    where creator_id = p_creator_id
  loop
    if r.platform = 'youtube' and coalesce(r.follower_count,0) > 0 and coalesce(r.video_count,0) > 0 and r.view_count is not null then
      v_ratio := (r.view_count::numeric / r.video_count) / r.follower_count;
      if (r.follower_count < 10000 and v_ratio < 0.1)
        or (r.follower_count >= 10000  and r.follower_count < 100000  and v_ratio < 0.04)
        or (r.follower_count >= 100000 and r.follower_count < 500000  and v_ratio < 0.025)
        or (r.follower_count >= 500000 and r.follower_count < 2000000 and v_ratio < 0.01)
        or (r.follower_count >= 2000000 and v_ratio < 0.003)
      then
        v_red_flag := true;
      end if;
    elsif r.platform = 'tiktok' and coalesce(r.follower_count,0) > 0 and r.like_count is not null then
      v_ratio := (r.like_count::numeric / r.follower_count) * 100;
      if (r.follower_count < 10000 and v_ratio < 0.8)
        or (r.follower_count >= 10000  and r.follower_count < 100000  and v_ratio < 0.6)
        or (r.follower_count >= 100000 and r.follower_count < 500000  and v_ratio < 0.4)
        or (r.follower_count >= 500000 and v_ratio < 0.15)
      then
        v_red_flag := true;
      end if;
    elsif r.platform = 'twitch' and coalesce(r.follower_count,0) > 0 and r.subscriber_count is not null then
      -- Conservative threshold on purpose -- sub-conversion data is
      -- thinner than YouTube/TikTok's, and plenty of legitimate small
      -- streamers sit well below "established channel" norms without
      -- being remotely suspicious. Only flag genuinely implausible cases.
      v_ratio := (r.subscriber_count::numeric / r.follower_count) * 100;
      if v_ratio < 0.1 then
        v_red_flag := true;
      end if;
    elsif r.platform = 'instagram' and coalesce(r.follower_count,0) > 0 and r.media_count is not null then
      if (r.follower_count >= 50000 and r.media_count < 10)
        or (r.follower_count >= 5000 and r.follower_count < 50000 and r.media_count < 3)
      then
        v_red_flag := true;
      end if;
    end if;
  end loop;

  select count(*) into v_evidence_count
  from evidence_uploads
  where creator_id = p_creator_id and evidence_type = 'Audience' and status = 'live_verified';

  if not v_has_platform then
    v_value := least(85, 50 + 15 * v_evidence_count);
  elsif v_red_flag then
    v_value := 35;
  else
    v_value := least(95, 75 + 5 * v_evidence_count);
  end if;

  insert into score_components (creator_id, component_key, label, weight, value, status)
  values (
    p_creator_id, 'audience_authenticity', 'Audience authenticity', 0.20, v_value,
    case when v_red_flag then 'flagged'
         when v_has_platform then 'live_verified'
         else 'evidence_submitted' end
  )
  on conflict (creator_id, component_key)
  do update set value = excluded.value, status = excluded.status, updated_at = now();

  if v_red_flag then
    select exists(
      select 1 from admin_flags
      where creator_profile_id = p_creator_id
        and resolved = false
        and reason like 'Automatic: audience authenticity%'
    ) into v_already_flagged;

    if not v_already_flagged then
      insert into admin_flags (creator_profile_id, flagged_by, reason)
      values (
        p_creator_id, null,
        'Automatic: audience authenticity plausibility check -- engagement-to-follower ratio implausibly low for connected platform(s). Not a confirmed finding, worth a manual look.'
      );
    end if;
  else
    update admin_flags
    set resolved = true
    where creator_profile_id = p_creator_id
      and resolved = false
      and reason like 'Automatic: audience authenticity%';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_recalc_audience_authenticity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform fn_apply_audience_authenticity(coalesce(new.creator_id, old.creator_id));
  return coalesce(new, old);
end;
$function$;

DROP TRIGGER IF EXISTS trg_recalc_audience_authenticity ON public.platform_connections;
CREATE TRIGGER trg_recalc_audience_authenticity
  AFTER INSERT OR DELETE OR UPDATE ON public.platform_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_recalc_audience_authenticity();

-- Recompute for every creator with a platform connection so the fix
-- (and the sync itself, for the drifted functions above) applies now.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT creator_id FROM platform_connections LOOP
    PERFORM fn_apply_audience_authenticity(r.creator_id);
  END LOOP;
END $$;
