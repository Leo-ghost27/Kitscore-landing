-- 2026-08-20e-fix-creator-id-vs-auth-uid.sql
--
-- Bug fix. Two things introduced earlier today (2026-08-20c and 2026-08-20d)
-- compared creator_id / profiles.id directly against auth.uid(). That's
-- wrong: profiles.id is its own generated PK, distinct from the
-- authenticated user id, mapped via profiles.auth_user_id = auth.uid().
-- Every other policy/function in this codebase resolves that indirection
-- through fn_current_profile_id(). These two didn't, which:
--   - broke creator_rate_cards inserts outright (RLS violation, loud)
--   - made fn_creator_active_portal_link_count() silently always return 0
--     (SECURITY DEFINER bypasses RLS, so no error -- just wrong, quiet)
--
-- Source files 2026-08-20c and 2026-08-20d have been corrected in place
-- to match what's actually live; this file exists as the audit record of
-- the bug and the fix, applied live via the Supabase MCP apply_migration
-- tool.

DROP POLICY "creators manage own rate card" ON creator_rate_cards;
CREATE POLICY "creators manage own rate card" ON creator_rate_cards
  FOR ALL
  USING (creator_id = fn_current_profile_id())
  WITH CHECK (creator_id = fn_current_profile_id());

CREATE OR REPLACE FUNCTION fn_creator_active_portal_link_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::integer
  FROM manager_portal_links
  WHERE fn_current_profile_id() = ANY(creator_ids)
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now());
$$;
