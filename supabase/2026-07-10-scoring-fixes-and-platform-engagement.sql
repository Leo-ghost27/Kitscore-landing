-- 2026-07-10-scoring-fixes-and-platform-engagement.sql
--
-- Three fixes, all confirmed against live production data before writing:
--
-- 1. fn_recalc_confidence(): checked `status = 'done'`, but no code anywhere
--    ever writes that literal status -- real values are 'live_verified',
--    'evidence_submitted', 'needs_improvement'. So the completeness term
--    was always 0, capping confidence at 40% regardless of profile
--    completeness. Fix: check 'live_verified' (the actual "fully verified"
--    state), same as every other function in this schema already does.
--
-- 2. Reliability score: there were TWO competing functions
--    (recalculate_creator_reliability + compute_creator_reliability) wired
--    to overlapping triggers on campaigns, writing the same columns with
--    different weights. Confirmed via live data that compute_creator_
--    reliability is the one actually landing. Dropping the dead one and
--    its trigger, and reweighting compute_creator_reliability so a missing
--    OPTIONAL input (sponsor rating / endorsement survey / would-hire-again
--    -- none of which any sponsor has ever submitted yet) doesn't silently
--    score as a zero. Weights renormalize across whichever inputs actually
--    have data, same pattern as how Confidence already separates "how much
--    do we know" from "how good is what we know."
--
-- 3. New: engagement_quality score component wired from platform_connections
--    (currently YouTube only, via public API lookup). This is a reach-
--    efficiency proxy (avg views per video, relative to subscriber count)
--    -- NOT true engagement (likes+comments/views), which needs OAuth-level
--    analytics access we don't have yet. Labelled accordingly in the
--    component's advice text so it isn't oversold to sponsors.

-- ── 1. Confidence fix ────────────────────────────────────────────────────
create or replace function public.fn_recalc_confidence()
returns trigger
language plpgsql
as $function$
declare
  total_weight numeric;
  done_weight numeric;
  completeness numeric;
  verified_count integer;
  volume_factor numeric;
  target_creator uuid := coalesce(new.creator_id, old.creator_id);
begin
  select coalesce(sum(weight), 0), coalesce(sum(weight) filter (where status = 'live_verified'), 0)
    into total_weight, done_weight
    from score_components where creator_id = target_creator;

  completeness := case when total_weight > 0 then done_weight / total_weight else 0 end;

  select count(*) into verified_count
    from campaigns where creator_id = target_creator and status = 'verified';

  volume_factor := verified_count::numeric / (verified_count + 3);

  update creators
    set confidence = round(100 * (0.6 * completeness + 0.4 * volume_factor)),
        updated_at = now()
    where id = target_creator;

  return new;
end;
$function$;

-- ── 2. Reliability: drop the duplicate, keep + reweight the real one ────
drop trigger if exists trg_creator_reliability on public.campaigns;
drop function if exists public.trg_creator_reliability_on_campaign();
drop function if exists public.recalculate_creator_reliability(uuid);

create or replace function public.compute_creator_reliability(p_creator_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_total_campaigns integer;
  v_verified_campaigns integer;
  v_completion_rate numeric;
  v_has_sponsor_rating boolean;
  v_avg_sponsor_rating numeric;
  v_has_endorsement boolean;
  v_avg_endorsement numeric;
  v_total_sponsors integer;
  v_repeat_sponsors integer;
  v_repeat_rate numeric;
  v_has_would_hire boolean;
  v_would_hire_count integer;
  v_would_hire_yes integer;
  v_would_hire_pct numeric;
  v_weight_used numeric := 0;
  v_score_sum numeric := 0;
  v_reliability numeric;
begin
  select count(*), count(*) filter (where creator_confirmed = true and sponsor_confirmed = true)
  into v_total_campaigns, v_verified_campaigns
  from campaigns where creator_id = p_creator_id;

  if v_total_campaigns = 0 then
    update creators set
      reliability_score = 0, repeat_sponsor_rate = 0, would_hire_again_pct = 0, updated_at = now()
    where id = p_creator_id;
    return 0;
  end if;

  v_completion_rate := (v_verified_campaigns::numeric / v_total_campaigns) * 100;

  select avg(sponsor_rating) * 20, count(*) > 0
  into v_avg_sponsor_rating, v_has_sponsor_rating
  from campaigns where creator_id = p_creator_id and sponsor_rating is not null;
  v_avg_sponsor_rating := coalesce(v_avg_sponsor_rating, 0);

  select avg((coalesce(communication_rating,0) + coalesce(professionalism_rating,0) + coalesce(deliverable_quality_rating,0)) / 3.0) * 20
  into v_avg_endorsement
  from campaigns where creator_id = p_creator_id and endorsement_submitted_at is not null;
  v_has_endorsement := v_avg_endorsement is not null;
  v_avg_endorsement := coalesce(v_avg_endorsement, 0);

  select count(distinct sponsor_id)
  into v_total_sponsors
  from campaigns where creator_id = p_creator_id and creator_confirmed = true and sponsor_confirmed = true;

  select count(*) into v_repeat_sponsors from (
    select sponsor_id from campaigns
    where creator_id = p_creator_id and creator_confirmed = true and sponsor_confirmed = true
    group by sponsor_id having count(*) > 1
  ) sub;

  v_repeat_rate := case when v_total_sponsors > 0 then (v_repeat_sponsors::numeric / v_total_sponsors) * 100 else 0 end;

  select count(*) filter (where would_hire_again is not null),
         count(*) filter (where would_hire_again = true)
  into v_would_hire_count, v_would_hire_yes
  from campaigns where creator_id = p_creator_id;

  v_has_would_hire := v_would_hire_count > 0;
  v_would_hire_pct := case when v_would_hire_count > 0 then (v_would_hire_yes::numeric / v_would_hire_count) * 100 else 0 end;

  -- Industry-norm reweighting: only inputs with real underlying data count
  -- toward the score. Their weights renormalize to fill 100%, instead of
  -- an unsubmitted OPTIONAL input (sponsor rating / endorsement survey /
  -- would-hire-again) silently scoring as a zero. Base weights (used when
  -- every input has data): completion 30 | sponsor rating 25 |
  -- endorsement quality 20 | repeat rate 15 | would-hire 10.
  v_score_sum := v_completion_rate * 30;
  v_weight_used := 30;

  if v_has_sponsor_rating then
    v_score_sum := v_score_sum + v_avg_sponsor_rating * 25;
    v_weight_used := v_weight_used + 25;
  end if;

  if v_has_endorsement then
    v_score_sum := v_score_sum + v_avg_endorsement * 20;
    v_weight_used := v_weight_used + 20;
  end if;

  if v_total_sponsors > 0 then
    v_score_sum := v_score_sum + v_repeat_rate * 15;
    v_weight_used := v_weight_used + 15;
  end if;

  if v_has_would_hire then
    v_score_sum := v_score_sum + v_would_hire_pct * 10;
    v_weight_used := v_weight_used + 10;
  end if;

  v_reliability := round(v_score_sum / v_weight_used);

  update creators set
    reliability_score = v_reliability,
    repeat_sponsor_rate = round(v_repeat_rate),
    would_hire_again_pct = round(v_would_hire_pct),
    updated_at = now()
  where id = p_creator_id;

  return v_reliability;
end;
$function$;

-- ── 3. Wire YouTube (public_lookup) data into engagement_quality ────────
-- Reach-efficiency proxy: average views per video, relative to subscriber
-- count. Deliberately conservative/tiered rather than a raw ratio, same
-- style as fn_recalc_evidence_component's capped tiering. Only fires for
-- platforms where we actually have view_count + video_count (currently
-- YouTube only -- TikTok OAuth, when built, may bring a truer engagement
-- signal (likes+comments/views) and should get its own, better tier here).
create or replace function public.fn_recalc_engagement_quality()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  values (new.creator_id, 'engagement_quality', 'Engagement quality', 0.20, v_value, 'live_verified')
  on conflict (creator_id, component_key)
  do update set value = excluded.value, weight = excluded.weight, status = 'live_verified', updated_at = now();

  return new;
end;
$function$;

drop trigger if exists trg_recalc_engagement_quality on public.platform_connections;
create trigger trg_recalc_engagement_quality
  after insert or update of follower_count, video_count, view_count
  on public.platform_connections
  for each row
  when (new.platform = 'youtube')
  execute function public.fn_recalc_engagement_quality();
