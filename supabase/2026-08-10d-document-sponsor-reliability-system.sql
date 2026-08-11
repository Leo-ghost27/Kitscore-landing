-- Retroactive documentation, 2026-08-10 pre-launch audit: the full
-- "creator rates sponsor" system below was already live in production
-- (used by the "Rate this sponsor" flow in app/campaigns.html and the
-- reliability line shown on every brief in app/briefs.html) but had
-- never been committed to this repo as a migration. Documenting it here
-- so the repo matches production. No logic changes in this file --
-- see 2026-08-10c-fix-sponsor-reliability-trigger-dead-column.sql for
-- the one real bug found and fixed during this audit.
--
-- How the pieces fit together:
--   campaigns.creator_rating / creator_outcome / creator_rating_notes /
--   creator_rating_submitted_at -- written once, by the creator, on a
--     verified campaign, enforced by fn_validate_creator_rating below.
--   sponsor_reports -- a separate table for the case where a creator
--     was ghosted or had ideas taken during brief discussion that never
--     became a real, confirmed campaign at all (so there's no campaigns
--     row to rate). No creator-facing submission UI exists for this
--     yet -- open item, not part of this fix.
--   fn_sponsor_reliability(sponsor_id) -- live, read-only view combining
--     both sources, called directly from app/briefs.html so a creator
--     sees real reliability signal before applying, not after.
--   sponsors.reliability_score / payment_reliability -- a separate,
--     persisted score/tier, recalculated by recalculate_sponsor_reliability()
--     and shown to admins in app/admin-sponsors.html. This is the one
--     that was silently frozen -- see the companion fix file.

CREATE OR REPLACE FUNCTION public.fn_validate_creator_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(fn_is_admin(), false) then
    return new;
  end if;

  if (new.creator_rating is distinct from old.creator_rating)
     or (new.creator_outcome is distinct from old.creator_outcome)
     or (new.creator_rating_notes is distinct from old.creator_rating_notes) then

    if new.creator_id is distinct from coalesce(fn_current_profile_id(), '00000000-0000-0000-0000-000000000000'::uuid) then
      raise exception 'Only the creator on this campaign can rate the sponsor';
    end if;
    if old.status != 'verified' then
      raise exception 'Sponsor ratings can only be submitted on verified campaigns';
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sponsor_reliability(p_sponsor_id uuid)
 RETURNS TABLE(sample_size integer, avg_rating numeric, paid_on_time_count integer, paid_late_count integer, ghosted_count integer, never_booked_count integer, other_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with verified as (
    select
      creator_rating::numeric as rating,
      coalesce(creator_outcome, 'paid_on_time') as outcome
    from campaigns
    where sponsor_id = p_sponsor_id
      and creator_rating is not null
  ),
  reported as (
    select
      null::numeric as rating,
      outcome
    from sponsor_reports
    where sponsor_id = p_sponsor_id
      and review_status = 'approved'
  ),
  combined as (
    select * from verified
    union all
    select * from reported
  )
  select
    count(*)::integer,
    round(avg(rating), 1),
    count(*) filter (where outcome = 'paid_on_time')::integer,
    count(*) filter (where outcome = 'paid_late')::integer,
    count(*) filter (where outcome = 'ghosted_after_delivery')::integer,
    count(*) filter (where outcome = 'never_booked_after_discussion')::integer,
    count(*) filter (where outcome = 'other')::integer
  from combined
  having count(*) > 0;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_sponsor_reliability(p_sponsor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  total_confirmed INTEGER;
  volume_score NUMERIC;
  has_creator_rating BOOLEAN;
  avg_creator_rating NUMERIC;
  approved_negative_reports INTEGER;
  penalty NUMERIC;
  score NUMERIC;
  reliability TEXT;
BEGIN
  SELECT COUNT(*) INTO total_confirmed
  FROM campaigns
  WHERE sponsor_id = p_sponsor_id
    AND creator_confirmed = TRUE
    AND sponsor_confirmed = TRUE;

  volume_score := LEAST(total_confirmed * 10, 100);

  SELECT avg(creator_rating) * 20, count(*) > 0
  INTO avg_creator_rating, has_creator_rating
  FROM campaigns
  WHERE sponsor_id = p_sponsor_id AND creator_rating IS NOT NULL;
  avg_creator_rating := coalesce(avg_creator_rating, 0);

  SELECT count(*) INTO approved_negative_reports
  FROM sponsor_reports
  WHERE sponsor_id = p_sponsor_id AND review_status = 'approved';
  penalty := LEAST(approved_negative_reports * 15, 60);

  IF has_creator_rating THEN
    score := volume_score * 0.75 + avg_creator_rating * 0.25;
  ELSE
    score := volume_score;
  END IF;
  score := GREATEST(score - penalty, 0);

  reliability := CASE
    WHEN total_confirmed = 0 AND approved_negative_reports = 0 THEN 'unrated'
    WHEN approved_negative_reports > 0 AND total_confirmed = 0 THEN 'flagged'
    WHEN total_confirmed < 3 THEN 'new'
    WHEN score >= 80 THEN 'trusted'
    WHEN score >= 50 THEN 'established'
    ELSE 'building'
  END;

  UPDATE sponsors
  SET
    reliability_score = score,
    campaigns_completed = total_confirmed,
    payment_reliability = reliability,
    updated_at = now()
  WHERE id = p_sponsor_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_sponsor_reliability_on_campaign()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.creator_confirmed = TRUE AND NEW.sponsor_confirmed = TRUE
     AND (OLD.creator_confirmed = FALSE OR OLD.sponsor_confirmed = FALSE) THEN
    PERFORM recalculate_sponsor_reliability(NEW.sponsor_id);
  END IF;
  RETURN NEW;
END;
$function$;
