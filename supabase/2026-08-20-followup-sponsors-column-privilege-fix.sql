-- 2026-08-20-followup-sponsors-column-privilege-fix.sql
--
-- Found by checking sponsors for the same class of bug just fixed on
-- managers (2026-08-20-followup-managers-column-privilege-fix.sql):
-- sponsors_owner_only RLS only checks row ownership (id =
-- fn_current_profile_id()), never which columns changed, and the
-- column-level GRANT underneath it was wide open.
--
-- Worse here in two ways:
-- 1. `anon` (fully unauthenticated, no session at all) also held UPDATE
--    on every column, not just `authenticated`. RLS still blocked anon
--    in practice (fn_current_profile_id() is null with no session), so
--    this wasn't independently exploitable -- removed anyway as
--    defense-in-depth, since there's no legitimate reason for anon to
--    hold it.
-- 2. The exposed columns are worse than a free plan upgrade:
--    restricted_at/restricted_by/restriction_reason means a sponsor
--    banned for fraud or abuse could have un-restricted themselves.
--    reliability_score/campaigns_completed/payment_reliability are the
--    exact "real verified performance, not self-reported claims" trust
--    signals creators rely on to evaluate a sponsor before working with
--    them -- a sponsor could have inflated their own reputation
--    directly, undermining the platform's core trust proposition, not
--    just its revenue.
--
-- Verified before touching anything: 0 sponsors currently restricted,
-- 3 real (non-test) sponsor accounts total -- pre-launch, nothing here
-- was actually exploited.
--
-- One legitimate direct write existed and had to be preserved instead
-- of just revoked: app/accept-invite.html's joinTeam() set
-- sponsors.plan = 'team' directly as the last of three raw client
-- writes, immediately after a real, already-validated team-invite
-- acceptance. Moved into fn_accept_team_invite() below (SECURITY
-- DEFINER, re-validates the invite itself rather than trusting the
-- page already did, and does invite-accept + team_members join + plan
-- bump atomically) -- same pattern this codebase already uses for
-- invite lookup (fn_lookup_team_invite, per its own comment fixing a
-- prior token-enumeration leak). app/accept-invite.html updated to
-- call the RPC instead of the three raw writes.
--
-- Confirmed no admin UI does a direct client write to sponsors' other
-- sensitive columns either, so nothing else depended on the old grant.

CREATE OR REPLACE FUNCTION fn_accept_team_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_invite team_invites;
  v_profile_id uuid := fn_current_profile_id();
BEGIN
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO v_invite FROM team_invites WHERE id = p_invite_id;
  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;
  IF v_invite.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This invite has already been accepted';
  END IF;
  IF v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'This invite has expired';
  END IF;

  UPDATE team_invites SET accepted_at = now() WHERE id = p_invite_id;

  INSERT INTO team_members (team_id, sponsor_id, role)
  VALUES (v_invite.team_id, v_profile_id, 'member')
  ON CONFLICT (team_id, sponsor_id) DO NOTHING;

  UPDATE sponsors SET plan = 'team' WHERE id = v_profile_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_accept_team_invite(uuid) TO authenticated;

REVOKE UPDATE ON public.sponsors FROM authenticated, anon;
GRANT UPDATE (company_name, logo_url, contact_email, updated_at) ON public.sponsors TO authenticated;

-- Verified post-fix: authenticated's UPDATE columns on sponsors are now
-- exactly {company_name, contact_email, logo_url, updated_at}. anon has
-- none. service_role/postgres retain all columns, unaffected.
