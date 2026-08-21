-- 2026-08-21-followup-contracts-dispute-fields-trigger-guard.sql
--
-- Found continuing the full-schema sweep after profiles/managers/
-- sponsors/creators. contracts already has two well-built triggers
-- guarding escrow fields (fn_lock_escrow_fields) and signing/voiding/
-- clause-scan fields (fn_validate_contract_changes) -- both correctly
-- bypass for service_role/admin and block everyone else regardless of
-- column grants. But neither guarded disputed_at, disputed_by,
-- admin_resolved_at, or admin_resolution_note. contracts_update_involved
-- RLS has no WITH CHECK at all (party-of-contract USING only), and
-- authenticated held a raw column grant on all four.
--
-- Confirmed via grep first: the real app never writes these columns
-- from the client. escrow-dispute.js (getAuthedSponsor, but writes via
-- adminClient/service_role), escrow-admin-refund.js and
-- escrow-admin-release.js (both getAuthedAdmin) are the only places
-- that touch them, all server-side. So a sponsor or creator party could
-- have bypassed /api/escrow entirely and self-resolved their own
-- dispute (set admin_resolved_at + a note, forcing held funds to
-- release without real Kitscore review), set disputed_by to the OTHER
-- party's id to falsely frame them, or silently cleared disputed_at to
-- erase a flag.
--
-- Fixed by extending fn_lock_escrow_fields rather than introducing a
-- third defense mechanism on this table -- these are the same "only the
-- payments/oversight system touches this" class of field the existing
-- trigger already protects.

CREATE OR REPLACE FUNCTION public.fn_lock_escrow_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (SELECT auth.role()) = 'service_role' OR fn_is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.escrow_status IS DISTINCT FROM OLD.escrow_status
     OR NEW.platform_fee_cents IS DISTINCT FROM OLD.platform_fee_cents
     OR NEW.escrow_payment_intent_id IS DISTINCT FROM OLD.escrow_payment_intent_id
     OR NEW.escrow_charge_id IS DISTINCT FROM OLD.escrow_charge_id
     OR NEW.escrow_transfer_id IS DISTINCT FROM OLD.escrow_transfer_id
     OR NEW.funded_at IS DISTINCT FROM OLD.funded_at
     OR NEW.released_at IS DISTINCT FROM OLD.released_at
     OR NEW.refunded_at IS DISTINCT FROM OLD.refunded_at
     OR NEW.deliverable_submitted_at IS DISTINCT FROM OLD.deliverable_submitted_at
     OR NEW.escrow_released_cents IS DISTINCT FROM OLD.escrow_released_cents
     OR NEW.escrow_refunded_cents IS DISTINCT FROM OLD.escrow_refunded_cents THEN
    RAISE EXCEPTION 'Escrow fields can only be changed by the payments system';
  END IF;

  IF OLD.status != 'draft' AND NEW.escrow_amount_cents IS DISTINCT FROM OLD.escrow_amount_cents THEN
    RAISE EXCEPTION 'Escrow fields can only be changed by the payments system';
  END IF;

  -- Added: dispute/admin-resolution fields were entirely unguarded.
  -- Real writes only ever happen via escrow-dispute.js /
  -- escrow-admin-refund.js / escrow-admin-release.js, all service_role.
  IF NEW.disputed_at IS DISTINCT FROM OLD.disputed_at
     OR NEW.disputed_by IS DISTINCT FROM OLD.disputed_by
     OR NEW.admin_resolved_at IS DISTINCT FROM OLD.admin_resolved_at
     OR NEW.admin_resolution_note IS DISTINCT FROM OLD.admin_resolution_note THEN
    RAISE EXCEPTION 'Dispute and resolution fields can only be changed by Kitscore''s dispute review process';
  END IF;

  RETURN NEW;
END;
$function$;
