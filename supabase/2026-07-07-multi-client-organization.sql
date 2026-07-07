-- 2026-07-07-multi-client-organization.sql
--
-- First build pass on "multi-client organization" (scoped in the July 7
-- status one-pager, carried on the open-items list since v22). Lets a Team
-- account group evaluations under named clients and track each client
-- through a pipeline: prospecting -> under_review -> approved -> active.
--
-- Follows the established safety pattern for this schema: no raw
-- cross-table subqueries in policies, only the SECURITY DEFINER helpers
-- (fn_current_profile_id, fn_is_team_member) that the July 7 recursion
-- audit confirmed are the only things terminal enough to be safe to use
-- inside a policy.
--
-- Deliberately NOT included here: enforcement of the 150/mo quota. The
-- quota is advertised in four places on the marketing site but isn't
-- enforced anywhere in code today (per the July 7 one-pager) -- turning it
-- into a real cap is a product decision, not a schema decision, and doing
-- it silently inside this migration would be exactly that kind of
-- undiscussed scope creep. The usage panel added in this pass displays
-- against the 150 figure without blocking anything.

-- =============================================================
-- 1. client_status enum + clients table
-- =============================================================
CREATE TYPE client_status AS ENUM ('prospecting', 'under_review', 'approved', 'active');

CREATE TABLE public.clients (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  status client_status NOT NULL DEFAULT 'prospecting',
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX clients_team_id_idx ON public.clients(team_id);
CREATE INDEX clients_team_id_status_idx ON public.clients(team_id, status);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Any team member can see and organize clients (matches team_notes'
-- member-permissive model, not teams' owner-only model -- this is shared
-- pipeline work, not an account-level setting).
CREATE POLICY clients_member_select ON public.clients FOR SELECT
  USING (fn_is_team_member(team_id) OR fn_is_admin());

CREATE POLICY clients_member_insert ON public.clients FOR INSERT
  WITH CHECK (created_by = fn_current_profile_id() AND fn_is_team_member(team_id));

CREATE POLICY clients_member_update ON public.clients FOR UPDATE
  USING (fn_is_team_member(team_id))
  WITH CHECK (fn_is_team_member(team_id));

-- Deletion is owner-only -- losing a client record (and its pipeline
-- history) shouldn't be a one-click action available to every member,
-- same reasoning as why branding edits are owner-gated in team.html.
CREATE POLICY clients_owner_delete ON public.clients FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.teams WHERE teams.id = team_id AND teams.owner_id = fn_current_profile_id()));

-- =============================================================
-- 2. Tag evaluations with an optional client
-- =============================================================
-- Nullable so every existing evaluation (and every workflow that doesn't
-- use client organization) is completely unaffected.
ALTER TABLE public.evaluations
  ADD COLUMN client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

CREATE INDEX evaluations_client_id_idx ON public.evaluations(client_id) WHERE client_id IS NOT NULL;

-- =============================================================
-- 3. fn_team_clients -- pipeline board read, same shape as
--    fn_team_roster/fn_team_notes/fn_team_pending_approvals from the
--    July 7 hardening pass: access enforced inside the function body via
--    fn_is_team_member, never a raw cross-table policy.
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_team_clients(p_team_id uuid)
RETURNS TABLE(
  client_id uuid, name text, status client_status,
  created_at timestamptz, evaluation_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT c.id, c.name, c.status, c.created_at,
    (SELECT count(*) FROM evaluations e WHERE e.client_id = c.id)
  FROM clients c
  WHERE c.team_id = p_team_id
    AND fn_is_team_member(p_team_id)
  ORDER BY c.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.fn_team_clients(uuid) TO authenticated;
