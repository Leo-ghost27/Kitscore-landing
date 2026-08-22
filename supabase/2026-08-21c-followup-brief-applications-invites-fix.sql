-- 2026-08-21c-followup-brief-applications-invites-fix.sql
--
-- Continuing the full-schema sweep (following the README guardrail:
-- check every real client write path via grep before deciding what's
-- safe, and check INSERT alongside UPDATE).
--
-- BRIEF_APPLICATIONS: fn_validate_brief_application's UPDATE branch only
-- guarded pitch_message/pitch_hash/pitch_locked_at against tampering --
-- it never checked `status` at all. brief_applications_creator_update
-- has no restriction beyond row ownership, so a creator could set
-- status = 'accepted' (or 'shortlisted'/'rejected') directly on their
-- own application, bypassing the sponsor's review entirely. Confirmed
-- the real flow via grep (app/briefs.html): sponsors call
-- updateApplication(appId, 'accepted'|'rejected') from their brief
-- management view; creators only ever withdraw. Fixed: creators may
-- only move their own application to 'withdrawn'; every other
-- transition requires being the sponsor who owns the brief (or admin).
--
-- CREATOR_CONTRACT_INVITES: creator_contract_invites_own (FOR ALL) let
-- a creator freely insert/update/delete their own rows -- including
-- escrow_amount_cents, status, and created_contract_id -- with no
-- trigger anywhere on the table. Confirmed via grep across every
-- app/*.html and every api/*.js + lib/*.js file: the only real code
-- path (creator-invite-sponsor-contract.js) authenticates via
-- getAuthedCreator then writes exclusively through adminClient()
-- (service_role). No client page reads or writes this table at all.
-- Pure unused attack surface -- a creator could have fabricated an
-- invite claiming any escrow amount, an already-'accepted' status, or
-- pointed created_contract_id at an arbitrary existing contract.
-- Locked to admin-only, same fix as evaluations_insert_sponsor
-- (2026-08-21b).
--
-- CAMPAIGN_CONFIRMATION_INVITES: same shape. "creators manage own
-- invites" / "sponsors manage own invites" were both FOR ALL with no
-- trigger, including confirmed_at/status/campaign_id. Confirmed every
-- client use is .select()-only (app/campaigns.html); creation goes
-- through creator-invite-sponsor.js / sponsor-invite-creator.js
-- (adminClient), and confirmation goes entirely through
-- confirm-campaign.html's RPCs (fn_lookup_campaign_invite /
-- fn_confirm_creator_campaign_invite / fn_confirm_campaign_invite),
-- never raw table access. Locked writes to admin-only, kept a plain
-- SELECT-own policy since that part is real and used.
--
-- Also checked and confirmed genuinely safe, no changes made:
-- - campaign_briefs: sponsor controls their own posting's status
--   (open/closed) -- no sensitive admin/verification field exists on
--   this table at all.
-- - approval_requests: already correctly scoped -- only the actual
--   team OWNER (not just any member) can write status/reviewed_by/
--   reviewed_at; members can only insert their own request.
-- - evidence_uploads: fn_validate_evidence_status already locks
--   `status` to admin-only; nothing else on this table is sensitive.
-- - clients: internal per-team CRM record, no sensitive fields.

CREATE OR REPLACE FUNCTION public.fn_validate_brief_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_brief_status brief_status;
  v_brief_sponsor uuid;
begin
  if tg_op = 'INSERT' then
    select status, sponsor_id into v_brief_status, v_brief_sponsor
    from campaign_briefs where id = new.brief_id;

    if v_brief_status is distinct from 'open' then
      raise exception 'This brief is no longer accepting applications';
    end if;
    if v_brief_sponsor = new.creator_id then
      raise exception 'A sponsor account cannot apply to its own brief';
    end if;

    new.pitch_locked_at := now();
    new.pitch_hash := encode(
      digest(
        coalesce(new.brief_id::text, '') || '|' ||
        coalesce(new.creator_id::text, '') || '|' ||
        coalesce(new.pitch_message, '') || '|' ||
        new.pitch_locked_at::text,
        'sha256'
      ),
      'hex'
    );

    return new;
  end if;

  -- tg_op = 'UPDATE'
  if fn_is_admin() or (select auth.role()) = 'service_role' then
    return new;
  end if;

  if new.pitch_message is distinct from old.pitch_message
     or new.pitch_hash is distinct from old.pitch_hash
     or new.pitch_locked_at is distinct from old.pitch_locked_at then
    raise exception 'A submitted pitch is locked evidence and cannot be edited';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'withdrawn' then
      if new.creator_id != fn_current_profile_id() then
        raise exception 'Only the applicant can withdraw an application';
      end if;
    else
      if not exists (select 1 from campaign_briefs where id = old.brief_id and sponsor_id = fn_current_profile_id()) then
        raise exception 'Only the sponsor who owns this brief can change an application''s status';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

DROP POLICY IF EXISTS creator_contract_invites_own ON public.creator_contract_invites;
CREATE POLICY creator_contract_invites_admin_only ON public.creator_contract_invites
  FOR ALL
  USING (fn_is_admin())
  WITH CHECK (fn_is_admin());

DROP POLICY IF EXISTS "creators manage own invites" ON public.campaign_confirmation_invites;
DROP POLICY IF EXISTS "sponsors manage own invites" ON public.campaign_confirmation_invites;

CREATE POLICY campaign_confirmation_invites_select_own ON public.campaign_confirmation_invites
  FOR SELECT
  USING (
    creator_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
    OR sponsor_id IN (SELECT id FROM profiles WHERE auth_user_id = auth.uid())
    OR fn_is_admin()
  );

CREATE POLICY campaign_confirmation_invites_admin_write ON public.campaign_confirmation_invites
  FOR ALL
  USING (fn_is_admin())
  WITH CHECK (fn_is_admin());

-- This closes the full table-by-table sweep list. Every table
-- originally flagged has now been checked and, where a real gap
-- existed, fixed. Next: the admin side specifically, then an audit
-- trail on escrow/contracts and an automated exception report.
