-- 2026-08-21-followup-teams-column-privilege-fix.sql
--
-- Same class of bug as managers/sponsors: teams_update has a proper
-- WITH CHECK (owner_id = fn_current_profile_id()) but no column
-- restriction and no trigger, and `plan` was directly grantable to
-- authenticated (and anon, unnecessarily). A team owner could self-set
-- their own team's plan directly.
--
-- Confirmed via grep: only `name` is ever client-updated
-- (app/team.html), and INSERT only ever sets name + owner_id (team
-- creation). Table-level grant, so a plain column-level REVOKE alone
-- would be a no-op (same lesson as the managers fix earlier in this
-- series) -- revoked the whole grant and re-granted just the two real
-- columns.

REVOKE INSERT, UPDATE ON public.teams FROM authenticated, anon;
GRANT INSERT (name, owner_id) ON public.teams TO authenticated;
GRANT UPDATE (name) ON public.teams TO authenticated;

-- Verified post-fix: authenticated's INSERT is {name, owner_id}, UPDATE
-- is {name} only. anon has neither. service_role/postgres unaffected.
--
-- team_members was checked in the same pass and needed no fix:
-- team_members_owner_update already restricts ALL updates (including
-- role) to the team owner via teams.owner_id = fn_current_profile_id(),
-- and team_members_self_join hardcodes role = 'member' on self-join
-- with a valid pending invite required. A regular member has no UPDATE
-- policy on their own row at all.
