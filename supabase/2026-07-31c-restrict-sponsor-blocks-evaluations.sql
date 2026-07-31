-- The restrict-sponsor admin action (fn_admin_set_sponsor_restriction) is
-- documented in app/admin-sponsors.html as blocking both new briefs AND
-- new evaluation requests. campaign_briefs_insert_own already enforced
-- this; evaluations_insert_sponsor did not -- a restricted sponsor could
-- still request new evaluations. Bringing it in line with the brief
-- policy's pattern. Applied live via Supabase migration on 2026-07-31.
DROP POLICY IF EXISTS evaluations_insert_sponsor ON public.evaluations;

CREATE POLICY evaluations_insert_sponsor ON public.evaluations
  FOR INSERT
  WITH CHECK (
    sponsor_id = fn_current_profile_id()
    AND EXISTS (SELECT 1 FROM sponsors WHERE sponsors.id = fn_current_profile_id())
    AND NOT EXISTS (
      SELECT 1 FROM sponsors s
      WHERE s.id = fn_current_profile_id() AND s.restricted_at IS NOT NULL
    )
  );
