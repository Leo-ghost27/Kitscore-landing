-- Real enforcement of sponsor restriction, at the RLS level -- the
-- friendly client-side message in briefs.html is UX only; this policy
-- is what actually blocks a restricted sponsor from posting. Admins can
-- still insert/manage regardless of restriction status (unchanged from
-- the original policy).

DROP POLICY campaign_briefs_insert_own ON public.campaign_briefs;

CREATE POLICY campaign_briefs_insert_own ON public.campaign_briefs
  FOR INSERT
  WITH CHECK (
    (sponsor_id = fn_current_profile_id()
     AND NOT EXISTS (SELECT 1 FROM sponsors s WHERE s.id = sponsor_id AND s.restricted_at IS NOT NULL))
    OR fn_is_admin()
  );
