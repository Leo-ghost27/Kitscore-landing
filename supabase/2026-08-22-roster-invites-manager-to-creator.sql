-- roster_invites_manager_to_creator
--
-- Reverse of manager_invites (creator invites a manager): a manager
-- invites a creator onto their roster. Needed to make self-serve
-- manager signup (2026-08-22) actually useful -- without this, a
-- manager who signs up cold has no way to populate their roster except
-- waiting for a creator to independently invite them.
--
-- Found fn_lookup_creator_invite already existed, attempting exactly
-- this by reinterpreting manager_invites' columns in reverse
-- (invited_by = the manager instead of always equal to creator_id).
-- That approach doesn't actually work: manager_invites.creator_id is
-- NOT NULL, but the entire point of this direction is inviting someone
-- who doesn't have a creator account yet -- there's no real value to
-- put there before acceptance. Confirmed via grep that this function is
-- unused anywhere (no handler, no UI) -- leaving it alone rather than
-- touching someone else's abandoned scaffolding, and using a distinct
-- table/function name here to avoid colliding with it.
--
-- Mirrors manager_invites' actual shape and RLS exactly otherwise,
-- including the invited_by/owner_id split (always equal today, same as
-- the original -- future-proofs for an agency staff member inviting on
-- behalf of their owner).

CREATE TABLE public.roster_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES profiles(id),
  email text NOT NULL,
  token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex') UNIQUE,
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manager_id, email)
);

ALTER TABLE public.roster_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY roster_invites_manager_all ON public.roster_invites
  FOR ALL
  USING (manager_id = fn_current_profile_id() OR fn_is_admin())
  WITH CHECK (manager_id = fn_current_profile_id() OR fn_is_admin());

CREATE POLICY roster_invites_invitee_accept_update ON public.roster_invites
  FOR UPDATE
  USING (
    accepted_at IS NULL AND expires_at > now()
    AND email = (SELECT p.email FROM profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    email = (SELECT p.email FROM profiles p WHERE p.auth_user_id = (SELECT auth.uid()))
  );

-- Same enumeration-leak-avoidance pattern as fn_lookup_manager_invite --
-- an unauthenticated person with just the token can look up the invite
-- without needing broad table SELECT (which would let them enumerate
-- others' invites).
CREATE FUNCTION public.fn_lookup_roster_invite(p_token text)
RETURNS TABLE(id uuid, manager_id uuid, email text, accepted_at timestamptz, expires_at timestamptz, manager_display_name text, agency_name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select ri.id, ri.manager_id, ri.email, ri.accepted_at, ri.expires_at, p.display_name as manager_display_name, m.agency_name
  from roster_invites ri
  join profiles p on p.id = ri.manager_id
  join managers m on m.id = ri.manager_id
  where ri.token = p_token
  limit 1;
$$;

GRANT EXECUTE ON FUNCTION fn_lookup_roster_invite(text) TO authenticated, anon;
