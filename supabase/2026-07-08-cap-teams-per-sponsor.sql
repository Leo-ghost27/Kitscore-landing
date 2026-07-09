-- 2026-07-08-cap-teams-per-sponsor.sql
--
-- Caps a sponsor at 2 team memberships total (owned or joined), enforced
-- at the RLS layer, not just hidden in the UI -- a client-side-only cap
-- is trivially bypassed by anyone calling the API directly.
--
-- No schema change needed: team_members' unique constraint was always
-- (team_id, sponsor_id), never sponsor_id alone, so the database never
-- actually prevented multiple teams per sponsor -- every part of the
-- app just assumed .maybeSingle() would only ever get one row back.
--
-- Two paths can add a team_members row for a sponsor, both need the cap:
--   1. Creating a new team (teams INSERT, then team_members INSERT as owner)
--   2. Accepting an invite to an existing team (team_members INSERT as member)

-- =============================================================
-- 1. teams: cap at the team-creation step itself, so a sponsor can't
--    even start a 3rd team.
-- =============================================================
DROP POLICY teams_insert ON teams;
CREATE POLICY teams_insert ON teams FOR INSERT
  WITH CHECK (
    owner_id = fn_current_profile_id()
    AND (SELECT count(*) FROM team_members WHERE sponsor_id = fn_current_profile_id()) < 2
  );

-- =============================================================
-- 2. team_members: team_members_owner_manage was a single ALL policy.
--    SELECT is already fully covered by team_members_select /
--    team_members_self_select, so only UPDATE/DELETE/INSERT need
--    recreating -- split out so the cap check can apply to INSERT only
--    (adding it to UPDATE/DELETE's shared clause would risk blocking
--    legitimate role changes or member removal on an already-full team).
-- =============================================================
DROP POLICY team_members_owner_manage ON team_members;

CREATE POLICY team_members_owner_update ON team_members FOR UPDATE
  USING (fn_is_admin() OR team_id IN (SELECT id FROM teams WHERE owner_id = fn_current_profile_id()))
  WITH CHECK (fn_is_admin() OR team_id IN (SELECT id FROM teams WHERE owner_id = fn_current_profile_id()));

CREATE POLICY team_members_owner_delete ON team_members FOR DELETE
  USING (fn_is_admin() OR team_id IN (SELECT id FROM teams WHERE owner_id = fn_current_profile_id()));

CREATE POLICY team_members_owner_insert ON team_members FOR INSERT
  WITH CHECK (
    (fn_is_admin() OR team_id IN (SELECT id FROM teams WHERE owner_id = fn_current_profile_id()))
    AND (SELECT count(*) FROM team_members WHERE sponsor_id = team_members.sponsor_id) < 2
  );

-- Add the same cap to the invite-acceptance path.
DROP POLICY team_members_self_join ON team_members;
CREATE POLICY team_members_self_join ON team_members FOR INSERT
  WITH CHECK (
    sponsor_id = fn_current_profile_id()
    AND EXISTS (
      SELECT 1 FROM team_invites ti
      WHERE ti.team_id = team_members.team_id
        AND ti.email = (SELECT p.email FROM profiles p WHERE p.id = fn_current_profile_id())
        AND ti.expires_at > now()
    )
    AND role = 'member'
    AND (SELECT count(*) FROM team_members WHERE sponsor_id = fn_current_profile_id()) < 2
  );
