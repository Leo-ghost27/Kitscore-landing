-- 2026-07-07-grant-clients-table-privileges.sql
--
-- Bug found by live testing: a member account (Eve Co, sox 404) hit
-- "Could not add client: permission denied for table clients" trying to
-- add a client through the actual UI. That error string is the tell --
-- it's a Postgres GRANT failure, surfaced before RLS is ever evaluated.
-- An RLS policy failure says "new row violates row-level security policy
-- for table clients" instead. Two different failure modes; this was the
-- grant, not the policy.
--
-- The 2026-07-07-multi-client-organization.sql migration created the
-- clients table and its four RLS policies but never granted base table
-- privileges to anon/authenticated. Every other table in this schema
-- (teams, team_members, evaluations, team_notes, ...) grants full
-- privileges to both roles and relies entirely on RLS as the actual
-- authorization gate -- clients was the one table that didn't match that
-- convention, because the grant statement was simply missing.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO anon, authenticated;
