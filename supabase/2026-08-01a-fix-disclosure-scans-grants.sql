-- 2026-08-01a-fix-disclosure-scans-grants.sql
--
-- Same bug class as sponsor_flags, support_tickets, and
-- trust_score_history fixed earlier: disclosure_scans has a correct RLS
-- policy (disclosure_scans_admin_only, fn_is_admin()) but no table-level
-- GRANT to anon/authenticated at all -- only service_role/postgres.
-- Blocked every admin from loading app/admin-disclosure-review.html
-- since the Phase 1 disclosure-scan feature shipped earlier today.
--
-- Applied directly to Supabase (project tpcriphrfrrgywycviqv) via the
-- Supabase MCP apply_migration tool on 2026-08-01; this file is the git
-- record of that change per supabase/README.md's practice.

GRANT SELECT, UPDATE ON public.disclosure_scans TO anon, authenticated;
