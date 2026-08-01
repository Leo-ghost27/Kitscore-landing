-- 2026-07-31h-fix-trust-score-history-grants.sql
--
-- Found during a full-repo gap scan: trust_score_history has a correct
-- RLS policy ("creators read own score history") but no table-level
-- GRANT to anon/authenticated at all -- only service_role/postgres. Same
-- root cause as the sponsor_flags and support_tickets grant bugs fixed
-- earlier today, different table. This one is higher severity: it's
-- queried directly by app/dashboard.html (every creator's own dashboard,
-- for their trust score history chart), not an admin tool -- meaning
-- every creator has been hitting "permission denied for table
-- trust_score_history" on their own dashboard.
--
-- Applied directly to Supabase (project tpcriphrfrrgywycviqv) via the
-- Supabase MCP apply_migration tool on 2026-07-31; this file is the git
-- record of that change per supabase/README.md's practice.

GRANT SELECT ON public.trust_score_history TO anon, authenticated;
