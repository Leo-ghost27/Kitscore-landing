-- 2026-07-31d-fix-support-tickets-grants.sql
--
-- support_tickets had correct RLS policies (support_tickets_admin_all,
-- support_tickets_select_own, support_tickets_insert_own -- all correctly
-- gated) but no table-level GRANT to anon/authenticated at all, only
-- service_role/postgres. Postgres checks table-level privileges before
-- RLS is evaluated, so every client request failed with "permission
-- denied for table support_tickets" regardless of role or row content --
-- this is why the admin Support Inbox page couldn't load anything even
-- though the admin's RLS policy was correct. Same root cause as the
-- sponsor_flags grant fix earlier today, different table.
--
-- Applied directly to Supabase (project tpcriphrfrrgywycviqv) via the
-- Supabase MCP apply_migration tool on 2026-07-31; this file is the git
-- record of that change per supabase/README.md's practice.

GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO anon, authenticated;
