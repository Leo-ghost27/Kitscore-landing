-- 2026-07-15d-briefs-contracts-grants-and-sponsor-visibility.sql
--
-- Two real bugs found via a live user's actual browser session (Supabase
-- API logs showed 403s), not caught by the earlier rollback-wrapped SQL
-- console tests -- because the SQL console runs as postgres/service_role,
-- which bypasses both of these problems entirely. Lesson: a trigger-logic
-- test via execute_sql proves the trigger works, it does NOT prove a real
-- authenticated browser session can reach the table at all.
--
-- Bug 1: campaign_briefs, brief_applications, and contracts were created
-- with RLS policies but NO base GRANT to the authenticated/anon roles.
-- In Postgres, RLS only applies on top of an existing GRANT -- without
-- the grant, every request gets a flat 403 "permission denied for
-- relation X" before RLS is ever evaluated. Every other table in this
-- schema (e.g. campaigns) already has these grants; these three were
-- simply missed when the tables were created.
--
-- Bug 2: sponsors RLS only allowed a creator to see a sponsor's row via
-- a shared campaign or shared team. Neither exists for the two NEW
-- flows this feature set introduces: a creator browsing an open brief
-- from a sponsor they've never worked with, or viewing a freshly
-- drafted contract before any campaign history exists. Added two more
-- sponsors SELECT policies to cover both.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_briefs TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brief_applications TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contracts TO authenticated, anon;

CREATE POLICY sponsors_select_via_open_brief ON public.sponsors FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM campaign_briefs cb WHERE cb.sponsor_id = sponsors.id AND cb.status = 'open'
  ));

CREATE POLICY sponsors_select_via_contract ON public.sponsors FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM contracts c WHERE c.sponsor_id = sponsors.id AND c.creator_id = fn_current_profile_id()
  ));
