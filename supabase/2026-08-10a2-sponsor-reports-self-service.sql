-- 2026-08-10, same pre-launch audit session as 2026-08-10c/d: adds the
-- one piece the existing creator-rates-sponsor system structurally
-- cannot cover -- a sponsor who discussed a collaboration, possibly ran
-- with the creator's pitch, and never booked. fn_validate_creator_rating
-- correctly requires status = 'verified' before a rating can attach to a
-- campaign row, and that's not a bug: a "campaign" that never happened
-- shouldn't produce a mutually-confirmed record. But it also means
-- creator_outcome = 'never_booked_after_discussion' was unreachable --
-- the one outcome value that exists specifically for this case had no
-- path to ever be set.
--
-- Self-reported + admin-reviewed, deliberately: an unmoderated negative
-- claim about a real business is a real risk, so this table is invisible
-- to the sponsor being named (even after approval -- no per-report
-- attribution, ever) and invisible to fn_sponsor_reliability's aggregate
-- until an admin sets review_status = 'approved'. No submission UI or
-- admin review queue exists yet -- schema and RLS only. Documented as a
-- known gap in 2026-08-10d.

CREATE TABLE public.sponsor_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES public.creators(id),
  sponsor_id uuid NOT NULL REFERENCES public.sponsors(id),
  related_brief_id uuid REFERENCES public.campaign_briefs(id),
  outcome text NOT NULL CHECK (outcome IN ('never_booked_after_discussion','ghosted_after_delivery','paid_late','other')),
  notes text,
  review_status text NOT NULL DEFAULT 'pending_review' CHECK (review_status IN ('pending_review','approved','rejected')),
  reviewed_at timestamptz,
  reviewer_id uuid REFERENCES public.profiles(id),
  reviewer_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sponsor_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY sponsor_reports_creator_insert ON public.sponsor_reports
  FOR INSERT WITH CHECK (creator_id = fn_current_profile_id());

CREATE POLICY sponsor_reports_select ON public.sponsor_reports
  FOR SELECT USING (creator_id = fn_current_profile_id() OR fn_is_admin());

CREATE POLICY sponsor_reports_admin_update ON public.sponsor_reports
  FOR UPDATE USING (fn_is_admin()) WITH CHECK (fn_is_admin());

GRANT SELECT, INSERT ON public.sponsor_reports TO authenticated;
GRANT UPDATE ON public.sponsor_reports TO authenticated;

-- Immutable once submitted, except for admin's review fields.
CREATE OR REPLACE FUNCTION public.fn_validate_sponsor_report()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  if coalesce(fn_is_admin(), false) then
    return new;
  end if;

  if new.outcome is distinct from old.outcome
     or new.notes is distinct from old.notes
     or new.sponsor_id is distinct from old.sponsor_id
     or new.creator_id is distinct from old.creator_id
     or new.related_brief_id is distinct from old.related_brief_id
     or new.review_status is distinct from old.review_status
     or new.reviewed_at is distinct from old.reviewed_at
     or new.reviewer_id is distinct from old.reviewer_id
     or new.reviewer_note is distinct from old.reviewer_note then
    raise exception 'A submitted report cannot be edited';
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_validate_sponsor_report ON public.sponsor_reports;
CREATE TRIGGER trg_validate_sponsor_report
  BEFORE UPDATE ON public.sponsor_reports
  FOR EACH ROW EXECUTE FUNCTION fn_validate_sponsor_report();

-- Block INSERT-time forgery of review fields (client shouldn't set these
-- to anything but the defaults; belt-and-braces alongside the INSERT
-- policy, which doesn't check individual column values).
CREATE OR REPLACE FUNCTION public.fn_sponsor_report_insert_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  if not coalesce(fn_is_admin(), false) then
    new.review_status := 'pending_review';
    new.reviewed_at := null;
    new.reviewer_id := null;
    new.reviewer_note := null;
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_sponsor_report_insert_defaults ON public.sponsor_reports;
CREATE TRIGGER trg_sponsor_report_insert_defaults
  BEFORE INSERT ON public.sponsor_reports
  FOR EACH ROW EXECUTE FUNCTION fn_sponsor_report_insert_defaults();

-- fn_sponsor_reliability's approved-reports arm and recalculate_sponsor_
-- reliability's report penalty (both already committed as the live,
-- current versions in 2026-08-10d-document-sponsor-reliability-system.sql)
-- depend on this table -- this file must apply before that one on a
-- fresh database. Trigger to recalculate on admin approve/un-approve:

CREATE OR REPLACE FUNCTION public.trg_sponsor_reliability_on_report_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.review_status IS DISTINCT FROM OLD.review_status
     AND (NEW.review_status = 'approved' OR OLD.review_status = 'approved') THEN
    PERFORM recalculate_sponsor_reliability(NEW.sponsor_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sponsor_reliability_on_report_review ON public.sponsor_reports;
CREATE TRIGGER trg_sponsor_reliability_on_report_review
  AFTER UPDATE ON public.sponsor_reports
  FOR EACH ROW EXECUTE FUNCTION trg_sponsor_reliability_on_report_review();
