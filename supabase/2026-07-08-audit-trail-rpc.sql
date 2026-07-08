-- 2026-07-08-audit-trail-rpc.sql
--
-- Fixes the audit trail export's blank "Actor" column and missing
-- approval-request rows. Root cause: the export used a raw client-side
-- query with `sponsors!sponsor_id(profiles!inner(display_name))`.
-- PostgREST enforces RLS independently on every joined table -- the
-- outer `sponsors` embed is permitted by sponsors_select_via_shared_team,
-- but the nested `profiles!inner` join is NOT permitted by profiles'
-- own RLS (profiles_select_merged only allows your own profile, a
-- creator's profile, or admin -- not a teammate's). So the nested join
-- silently returned nothing, the outer evaluations row still showed up,
-- and "Actor" was blank. The approval_requests query had the same shape
-- of problem via its `requester:sponsors!requested_by(...)` /
-- `reviewer:sponsors!reviewed_by(...)` aliases, which is why those rows
-- were missing from the export entirely, and the client code was also
-- silently swallowing the query's error either way.
--
-- Every other teammate-name lookup in this app (fn_team_roster,
-- fn_team_notes, fn_team_pending_approvals) already avoids this by going
-- through a SECURITY DEFINER function instead of a raw client embed --
-- the audit trail export just didn't follow that pattern. This closes
-- that gap the correct way instead of patching around it client-side.

CREATE OR REPLACE FUNCTION public.fn_team_audit_trail(p_team_id uuid)
RETURNS TABLE(
  event_date timestamptz, event_type text, actor_name text,
  subject_name text, detail text, status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT
    e.created_at,
    'Evaluation'::text,
    sp.display_name,
    cr.display_name,
    CASE WHEN cl.name IS NOT NULL THEN 'Client: ' || cl.name ELSE '' END,
    (CASE WHEN e.unlocked THEN 'Unlocked' ELSE 'Locked' END) ||
      (CASE WHEN e.recommendation_verdict IS NOT NULL THEN ' / ' || e.recommendation_verdict ELSE '' END)
  FROM evaluations e
  LEFT JOIN profiles sp ON sp.id = e.sponsor_id
  LEFT JOIN profiles cr ON cr.id = e.creator_id
  LEFT JOIN clients cl ON cl.id = e.client_id
  WHERE e.team_id = p_team_id AND fn_is_team_member(p_team_id)

  UNION ALL

  SELECT
    COALESCE(ar.reviewed_at, ar.created_at),
    'Approval request'::text,
    req.display_name,
    COALESCE(target_cr.display_name, ar.action_type, '$29 unlock'),
    COALESCE(ar.note, '') || (CASE WHEN target_cl.name IS NOT NULL THEN (CASE WHEN ar.note IS NOT NULL THEN ' -- ' ELSE '' END) || 'Client: ' || target_cl.name ELSE '' END),
    ar.status || (CASE WHEN rev.display_name IS NOT NULL THEN ' by ' || rev.display_name ELSE '' END)
  FROM approval_requests ar
  LEFT JOIN profiles req ON req.id = ar.requested_by
  LEFT JOIN profiles rev ON rev.id = ar.reviewed_by
  LEFT JOIN evaluations target_e ON ar.target_type = 'evaluation' AND target_e.id = ar.target_id
  LEFT JOIN profiles target_cr ON target_cr.id = target_e.creator_id
  LEFT JOIN clients target_cl ON target_cl.id = target_e.client_id
  WHERE ar.team_id = p_team_id AND fn_is_team_member(p_team_id)

  ORDER BY 1;
$$;
GRANT EXECUTE ON FUNCTION public.fn_team_audit_trail(uuid) TO authenticated;
