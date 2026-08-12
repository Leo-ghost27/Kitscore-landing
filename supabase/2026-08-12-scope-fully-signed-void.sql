-- 2026-08-12-scope-fully-signed-void.sql
--
-- Came up while building the contract-flag notification email: the
-- sponsor-side email tells a sponsor to void and resend when their
-- fully-signed contract gets flagged, but that button was hidden by
-- app/contracts.html's canVoid, NOT actually blocked by the database --
-- fn_validate_contract_changes only checked that the caller IS the
-- sponsor, nothing about contract status. Any sponsor could void ANY
-- fully-signed contract via a direct API call, bypassing the UI
-- entirely. That's the real gap; the hidden button was never the
-- protection it looked like.
--
-- The UI hid it for fully_signed contracts on purpose -- once both
-- sides have signed, letting a sponsor void at will means they could
-- back out of a completed, binding deal whenever convenient (e.g.
-- right before a creator delivers). That's a real creator-protection
-- concern and stays in place as the default.
--
-- What changes: a fully-signed contract can now ALSO be voided if
-- Kitscore currently has an active flag on it (disputed_at set,
-- unresolved) -- this is the specific "we caught a bad clause, sponsor
-- needs to redraft" case from admin-contracts.html's "Flag a problem",
-- which is admin-mediated, not sponsor caprice, so the general
-- protection doesn't need to block it. Still refused if escrow has any
-- funds moved (escrow_status != 'not_funded') -- voiding the paperwork
-- while money has already moved creates a contradictory state; that
-- case belongs in Escrow Oversight's release/refund tools instead.
--
-- Enforced here in the trigger, not just app/contracts.html's canVoid --
-- see the comment above for why hiding a button was never sufficient.
--
-- Applied directly to Supabase via the Supabase MCP apply_migration tool
-- per supabase/README.md's practice.

CREATE OR REPLACE FUNCTION public.fn_validate_contract_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if fn_is_admin() or (select auth.role()) = 'service_role' then
    return new;
  end if;

  if new.clause_scan_flagged is distinct from old.clause_scan_flagged
     or new.clause_scan_concerns is distinct from old.clause_scan_concerns
     or new.clause_scan_rationale is distinct from old.clause_scan_rationale
     or new.clause_scan_model is distinct from old.clause_scan_model
     or new.clause_scanned_at is distinct from old.clause_scanned_at then
    raise exception 'Contract clause scan results can only be set by the scanning system';
  end if;

  if new.status = 'void' and old.status != 'void' then
    if new.sponsor_id != fn_current_profile_id() then
      raise exception 'Only the sponsor on this contract can void it';
    end if;
    if old.status = 'fully_signed' then
      if old.disputed_at is null or old.admin_resolved_at is not null then
        raise exception 'A fully signed contract can only be voided while Kitscore has an active flag on it -- contact support to resolve this another way';
      end if;
      if old.escrow_status != 'not_funded' then
        raise exception 'This contract has funded escrow -- resolve that through Escrow Oversight before voiding';
      end if;
    end if;
  end if;

  if old.status != 'draft' then
    if new.title is distinct from old.title
       or new.deliverables is distinct from old.deliverables
       or new.compensation is distinct from old.compensation
       or new.usage_rights is distinct from old.usage_rights
       or new.exclusivity_terms is distinct from old.exclusivity_terms
       or new.ftc_disclosure_required is distinct from old.ftc_disclosure_required
       or new.additional_terms is distinct from old.additional_terms then
      raise exception 'Contract terms are locked once sent -- void this contract and create a new one to change terms';
    end if;
  end if;

  if new.sponsor_signed_at is distinct from old.sponsor_signed_at
     or new.sponsor_signature_name is distinct from old.sponsor_signature_name then
    if new.sponsor_id != fn_current_profile_id() then
      raise exception 'Only the sponsor on this contract can sign as the sponsor';
    end if;
    if old.sponsor_signed_at is not null then
      raise exception 'This contract has already been signed by the sponsor';
    end if;
  end if;

  if new.creator_signed_at is distinct from old.creator_signed_at
     or new.creator_signature_name is distinct from old.creator_signature_name then
    if new.creator_id != fn_current_profile_id() then
      raise exception 'Only the creator on this contract can sign as the creator';
    end if;
    if old.creator_signed_at is not null then
      raise exception 'This contract has already been signed by the creator';
    end if;
  end if;

  if new.sponsor_signed_at is not null and new.creator_signed_at is not null then
    new.status := 'fully_signed';
  elsif new.sponsor_signed_at is not null then
    new.status := 'signed_by_sponsor';
  elsif new.creator_signed_at is not null then
    new.status := 'signed_by_creator';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;
