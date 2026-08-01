-- 2026-07-31g-creator-videos-admin-select.sql
--
-- creator_videos had RLS enabled with zero policies and no grant to
-- authenticated at all -- effectively unreadable by anyone except
-- service_role. Needed now so admin-brand-safety.html can join a
-- flagged scan's flagged_titles against this table to render a direct
-- video link. Same owner-or-admin shape already used for
-- brand_safety_answers, so this also means a creator could see their
-- own scanned video list from their own dashboard later if that's ever
-- built -- not done in this change, just no longer blocked by policy.
GRANT SELECT ON public.creator_videos TO authenticated;

CREATE POLICY creator_videos_owner_or_admin ON public.creator_videos FOR SELECT
  USING (creator_id = fn_current_profile_id() OR fn_is_admin());
