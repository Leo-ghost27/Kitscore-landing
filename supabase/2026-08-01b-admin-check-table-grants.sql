-- 2026-08-01b-admin-check-table-grants.sql
--
-- Turns the manual audit query run four times today (sponsor_flags via
-- SECURITY DEFINER fix, support_tickets, trust_score_history,
-- disclosure_scans -- all the same root cause: a table has a correct RLS
-- policy but no table-level GRANT to anon/authenticated at all, so
-- Postgres blocks every client request before RLS is even evaluated)
-- into a permanent, one-click check on System Health instead of
-- something that only surfaces by accident when someone happens to click
-- into the broken page. See app/admin-system.html.
--
-- SECURITY DEFINER + admin-only because pg_policy/pg_tables introspection
-- shouldn't be handed to every authenticated user.
--
-- Applied directly to Supabase (project tpcriphrfrrgywycviqv) via the
-- Supabase MCP apply_migration tool on 2026-08-01; this file is the git
-- record of that change per supabase/README.md's practice.

CREATE OR REPLACE FUNCTION public.fn_admin_check_table_grants()
RETURNS TABLE(table_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  RETURN QUERY
    SELECT t.tablename::text
    FROM pg_tables t
    WHERE t.schemaname = 'public'
      AND EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = ('public.' || t.tablename)::regclass)
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.table_privileges tp
        WHERE tp.table_name = t.tablename AND tp.table_schema = 'public'
          AND tp.grantee = 'authenticated' AND tp.privilege_type = 'SELECT'
      )
    ORDER BY t.tablename;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_admin_check_table_grants() TO authenticated;
