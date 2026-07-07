-- 2026-07-07-recursion-fix-and-hardening.sql
--
-- Consolidates every RLS/schema change made in response to the July 7
-- production outage (infinite recursion in profiles/team_members/teams
-- policies), applied directly to tpcriphrfrrgywycviqv. Written up here per
-- the rule established in the v26 outage handoff: every RLS change gets a
-- committed file, even a single DROP/CREATE POLICY line, so the next
-- session can read live policy state instead of reconstructing it by hand.
--
-- Order matters: this is the order the statements were actually applied in.

-- =============================================================
-- 1. THE ACTUAL OUTAGE FIX (applied by Gina directly via the Supabase
--    Policies GUI, one-click "Delete policy" -- not run as SQL, recorded
--    here so it exists in the repo at all)
-- =============================================================
-- profiles_select_via_shared_team queried team_members directly, which
-- queried teams directly, which queried profiles directly -- a three-way
-- cycle. This breaks it at its newest, most avoidable link.
DROP POLICY IF EXISTS profiles_select_via_shared_team ON public.profiles;

-- =============================================================
-- 2. HARDENING: teams' 4 policies used a raw subquery against profiles
--    instead of the SECURITY DEFINER fn_current_profile_id() helper that
--    every other cross-table policy in this schema uses specifically to
--    avoid this risk. Didn't cause the outage on its own (profiles no
--    longer references teams), but it's the same latent shape -- closing
--    it so the exact same class of recursion can't reform if a future
--    profiles policy ever references teams again.
-- =============================================================
DROP POLICY IF EXISTS teams_select ON public.teams;
CREATE POLICY teams_select ON public.teams FOR SELECT
  USING (owner_id = fn_current_profile_id() OR fn_is_team_member(id));

DROP POLICY IF EXISTS teams_insert ON public.teams;
CREATE POLICY teams_insert ON public.teams FOR INSERT
  WITH CHECK (owner_id = fn_current_profile_id());

DROP POLICY IF EXISTS teams_update ON public.teams;
CREATE POLICY teams_update ON public.teams FOR UPDATE
  USING (owner_id = fn_current_profile_id())
  WITH CHECK (owner_id = fn_current_profile_id());

DROP POLICY IF EXISTS teams_delete ON public.teams;
CREATE POLICY teams_delete ON public.teams FOR DELETE
  USING (owner_id = fn_current_profile_id());

-- =============================================================
-- 3. REBUILD "see your teammate's name", the safe way. This was
--    profiles_select_via_shared_team's actual job before it caused the
--    outage -- rebuilt as three SECURITY DEFINER functions instead of a
--    raw cross-table policy. Access is enforced INSIDE each function body
--    (fn_is_team_member / owner check), not via a table-level policy that
--    other policies could loop back through -- this is what makes it safe
--    against recursion structurally, not just by convention.
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_team_roster(p_team_id uuid)
RETURNS TABLE(member_id uuid, sponsor_id uuid, role text, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT tm.id, tm.sponsor_id, tm.role, p.display_name
  FROM team_members tm
  JOIN profiles p ON p.id = tm.sponsor_id
  WHERE tm.team_id = p_team_id
    AND fn_is_team_member(p_team_id);
$$;
GRANT EXECUTE ON FUNCTION public.fn_team_roster(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_team_notes(p_team_id uuid)
RETURNS TABLE(
  note_id uuid, author_id uuid, author_display_name text,
  creator_id uuid, creator_display_name text, content text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT tn.id, tn.author_id, ap.display_name, tn.creator_id, cp.display_name, tn.content, tn.created_at
  FROM team_notes tn
  JOIN profiles ap ON ap.id = tn.author_id
  LEFT JOIN profiles cp ON cp.id = tn.creator_id
  WHERE tn.team_id = p_team_id
    AND fn_is_team_member(p_team_id)
  ORDER BY tn.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.fn_team_notes(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_team_pending_approvals(p_team_id uuid)
RETURNS TABLE(
  request_id uuid, requested_by uuid, requester_display_name text,
  action_type text, target_type text, target_id uuid, note text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT ar.id, ar.requested_by, p.display_name, ar.action_type, ar.target_type, ar.target_id, ar.note, ar.created_at
  FROM approval_requests ar
  JOIN profiles p ON p.id = ar.requested_by
  WHERE ar.team_id = p_team_id
    AND ar.status = 'pending'
    AND EXISTS (SELECT 1 FROM teams WHERE teams.id = p_team_id AND teams.owner_id = fn_current_profile_id())
  ORDER BY ar.created_at ASC;
$$;
GRANT EXECUTE ON FUNCTION public.fn_team_pending_approvals(uuid) TO authenticated;
