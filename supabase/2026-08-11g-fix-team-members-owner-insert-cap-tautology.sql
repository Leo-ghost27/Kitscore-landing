-- 2026-08-11g-fix-team-members-owner-insert-cap-tautology.sql
--
-- Found during a systematic RLS policy audit (all ~85 live policies
-- read via pg_policies and reviewed for logic bugs, not just drift).
--
-- team_members_owner_insert's cap check, unchanged since its original
-- migration (2026-07-08-cap-teams-per-sponsor.sql), was:
--   (SELECT count(*) FROM team_members WHERE sponsor_id = team_members.sponsor_id) < 2
-- The subquery's own FROM clause is also named team_members, so the
-- unqualified team_members.sponsor_id on the right-hand side doesn't
-- resolve to the row being inserted as intended -- it resolves to the
-- subquery's own scope, making the WHERE a tautology (sponsor_id =
-- sponsor_id, true for every row with a non-null sponsor_id).
-- pg_policies confirms this is genuinely how Postgres resolved it, not
-- a display artifact: it read back as
-- team_members_1.sponsor_id = team_members_1.sponsor_id.
--
-- Effect: the subquery counted every team_members row on the entire
-- platform, not the target sponsor's own rows. Confirmed live impact
-- before fixing: total row count was already at 2, meaning this policy
-- was actively blocking every sponsor's team-owner insert platform-wide
-- -- not a future risk, a currently-live one. team_members_self_join
-- (the invite-acceptance path) was unaffected: it correctly filters on
-- fn_current_profile_id(), a function call with no name collision, so
-- it never hit this ambiguity. teams_insert's own cap check has the
-- same safe shape.
--
-- Fix: alias the subquery's FROM clause so the outer reference is
-- unambiguous.

DROP POLICY IF EXISTS team_members_owner_insert ON public.team_members;
CREATE POLICY team_members_owner_insert ON public.team_members FOR INSERT
  WITH CHECK (
    (fn_is_admin() OR team_id IN (SELECT id FROM teams WHERE owner_id = fn_current_profile_id()))
    AND (SELECT count(*) FROM team_members tm WHERE tm.sponsor_id = team_members.sponsor_id) < 2
  );
