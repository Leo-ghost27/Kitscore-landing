-- Kitscore migration — 2026-07-06
-- 1. Fixes team_members so an invited member can actually self-join
--    (previously only team_members_owner_manage existed, which requires
--    being the team owner — an invited member's own upsert in
--    accept-invite.html had no policy to satisfy).
-- 2. Adds approval_requests: a member on a Team plan must get owner
--    sign-off before unlocking a paid evaluation; owner unlocks freely.
--
-- Run this directly in the Supabase SQL editor against project
-- tpcriphrfrrgywycviqv. Additive only — safe to run once.

-- =============================================================
-- 1. team_members: allow an invited member to insert their own row
-- =============================================================

CREATE POLICY team_members_self_join ON public.team_members FOR INSERT
  WITH CHECK (
    sponsor_id = fn_current_profile_id()
    AND EXISTS (
      SELECT 1 FROM team_invites ti
      WHERE ti.team_id = team_members.team_id
        AND ti.email = (SELECT p.email FROM profiles p WHERE p.id = fn_current_profile_id())
        AND ti.expires_at > now()
    )
    AND role = 'member' -- an invite can only ever seat someone as 'member', never 'owner'
  );

-- =============================================================
-- 2. approval_requests
-- =============================================================

CREATE TABLE IF NOT EXISTS public.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.profiles(id),
  action_type text NOT NULL,       -- e.g. 'evaluation_unlock'
  target_type text NOT NULL,       -- e.g. 'creator'
  target_id uuid,                  -- e.g. creator profile id being evaluated
  note text,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY approval_requests_team_select ON public.approval_requests FOR SELECT
  USING (fn_is_team_member(team_id) OR fn_is_admin());

CREATE POLICY approval_requests_member_insert ON public.approval_requests FOR INSERT
  WITH CHECK (requested_by = fn_current_profile_id() AND fn_is_team_member(team_id));

-- Only the team owner (or platform admin) can move a request out of 'pending'
CREATE POLICY approval_requests_owner_review ON public.approval_requests FOR UPDATE
  USING (fn_is_admin() OR team_id IN (SELECT teams.id FROM teams WHERE teams.owner_id = fn_current_profile_id()))
  WITH CHECK (fn_is_admin() OR team_id IN (SELECT teams.id FROM teams WHERE teams.owner_id = fn_current_profile_id()));

CREATE INDEX IF NOT EXISTS idx_approval_requests_team_status ON public.approval_requests(team_id, status);

-- =============================================================
-- 3. evaluations internal review workflow: owner-only approve/reject
-- =============================================================
-- The existing evaluations_team_approval RLS policy lets ANY team member
-- update approval_status, including moving it to 'approved'/'rejected' —
-- there was no role check. A member could draft AND approve their own
-- evaluation. This trigger closes that: any team member can submit
-- ('draft' -> 'pending_approval'), only the team owner (or platform admin)
-- can decide ('pending_approval' -> 'approved'/'rejected').

CREATE OR REPLACE FUNCTION public.fn_validate_evaluation_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF fn_is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
    IF NEW.approval_status IN ('approved', 'rejected') THEN
      IF NOT EXISTS (
        SELECT 1 FROM teams WHERE teams.id = NEW.team_id AND teams.owner_id = fn_current_profile_id()
      ) THEN
        RAISE EXCEPTION 'Only the team owner can approve or reject an evaluation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_evaluation_approval ON public.evaluations;
CREATE TRIGGER trg_validate_evaluation_approval
  BEFORE UPDATE ON public.evaluations
  FOR EACH ROW EXECUTE FUNCTION fn_validate_evaluation_approval();
