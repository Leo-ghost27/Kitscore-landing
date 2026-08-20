-- 2026-08-20b-fix-campaign-briefs-rls-recursion.sql
--
-- Bug: campaign_briefs_select_open (added in the Pro early-access
-- migration) checked brief_applications directly inside its USING
-- clause. brief_applications' own sponsor-facing policies
-- (brief_applications_sponsor_select / _sponsor_update) check back
-- into campaign_briefs to confirm the sponsor owns the brief -- so
-- campaign_briefs -> brief_applications -> campaign_briefs formed a
-- cycle, surfaced by Postgres as "infinite recursion detected in
-- policy for relation campaign_briefs" the moment a sponsor loaded
-- anything that touched either table (directory, profile-sponsor,
-- history all route through this).
--
-- Fix: same pattern already used for fn_current_profile_id() /
-- fn_is_admin() -- wrap the brief_applications check in a
-- SECURITY DEFINER function. A SECURITY DEFINER function's internal
-- queries bypass RLS entirely (runs as the function owner, which has
-- bypassrls) rather than re-evaluating brief_applications' policies,
-- so the cycle never forms.
CREATE OR REPLACE FUNCTION fn_creator_applied_to_brief(p_brief_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM brief_applications ba
    WHERE ba.brief_id = p_brief_id AND ba.creator_id = fn_current_profile_id()
  );
$function$;

GRANT EXECUTE ON FUNCTION fn_creator_applied_to_brief(uuid) TO authenticated;

DROP POLICY IF EXISTS "campaign_briefs_select_open" ON campaign_briefs;

CREATE POLICY "campaign_briefs_select_open" ON campaign_briefs
  FOR SELECT
  USING (
    (
      status = 'open'::brief_status
      AND (
        created_at <= now() - interval '24 hours'
        OR EXISTS (
          SELECT 1 FROM creators c
          WHERE c.id = fn_current_profile_id() AND c.plan = 'pro'
        )
        OR fn_creator_applied_to_brief(campaign_briefs.id)
      )
    )
    OR sponsor_id = fn_current_profile_id()
    OR fn_is_admin()
  );

-- fn_count_pro_gated_briefs() had the same direct brief_applications
-- reference; same fix.
CREATE OR REPLACE FUNCTION fn_count_pro_gated_briefs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_creator_id uuid := fn_current_profile_id();
  v_is_pro boolean;
  v_count integer;
BEGIN
  SELECT (plan = 'pro') INTO v_is_pro FROM creators WHERE id = v_creator_id;
  IF v_is_pro IS NOT TRUE THEN
    SELECT count(*) INTO v_count
    FROM campaign_briefs b
    WHERE b.status = 'open'::brief_status
      AND b.created_at > now() - interval '24 hours'
      AND NOT fn_creator_applied_to_brief(b.id);
    RETURN coalesce(v_count, 0);
  END IF;
  RETURN 0;
END;
$function$;

GRANT EXECUTE ON FUNCTION fn_count_pro_gated_briefs() TO authenticated;
