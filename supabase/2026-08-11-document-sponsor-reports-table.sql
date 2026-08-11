-- 2026-08-11-document-sponsor-reports-table.sql
--
-- Retroactive documentation: sponsor_reports and its 3 RLS policies were
-- already live in production (referenced by fn_sponsor_reliability in
-- 2026-08-10d-document-sponsor-reliability-system.sql) but the table
-- definition and policies themselves were never committed as a migration.
-- Documenting them here so the repo matches production -- same pattern as
-- 2026-08-10d. No logic changes in this file.
--
-- This is the table backing the new creator-facing "Report an issue" flow
-- in app/briefs.html (2026-08-11): a creator can report a sponsor for
-- ghosting or idea theft during brief discussion that never became a real,
-- confirmed campaign (so there's no campaigns row to rate via the separate
-- "Rate this sponsor" flow). Reports are pending_review by default and only
-- count toward the sponsor's public reliability score once an admin sets
-- review_status = 'approved' (see fn_sponsor_reliability).

CREATE TABLE IF NOT EXISTS public.sponsor_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES public.creators(id),
  sponsor_id uuid NOT NULL REFERENCES public.sponsors(id),
  related_brief_id uuid REFERENCES public.campaign_briefs(id),
  outcome text NOT NULL CHECK (outcome = ANY (ARRAY['never_booked_after_discussion', 'ghosted_after_delivery', 'paid_late', 'other'])),
  notes text,
  review_status text NOT NULL DEFAULT 'pending_review' CHECK (review_status = ANY (ARRAY['pending_review', 'approved', 'rejected'])),
  reviewed_at timestamptz,
  reviewer_id uuid REFERENCES public.profiles(id),
  reviewer_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sponsor_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sponsor_reports_creator_insert ON public.sponsor_reports;
CREATE POLICY sponsor_reports_creator_insert ON public.sponsor_reports
  FOR INSERT
  WITH CHECK (creator_id = fn_current_profile_id());

DROP POLICY IF EXISTS sponsor_reports_select ON public.sponsor_reports;
CREATE POLICY sponsor_reports_select ON public.sponsor_reports
  FOR SELECT
  USING (creator_id = fn_current_profile_id() OR fn_is_admin());

DROP POLICY IF EXISTS sponsor_reports_admin_update ON public.sponsor_reports;
CREATE POLICY sponsor_reports_admin_update ON public.sponsor_reports
  FOR UPDATE
  USING (fn_is_admin())
  WITH CHECK (fn_is_admin());
