-- 2026-07-31b-partial-escrow-settlement.sql
--
-- Supports mediated partial settlement: admin releases part of a held
-- escrow to the creator and/or refunds part back to the sponsor,
-- instead of only all-or-nothing. Needed because "creator delivered,
-- just not to the sponsor's expectation" is a real mediation outcome
-- (e.g. "we agreed on 20% release, rest refunded") that the previous
-- force-release/force-refund endpoints couldn't express -- they always
-- moved the entire escrowed amount.
--
-- escrow_amount_cents remains the fixed total charged to the sponsor at
-- fund time (unchanged, still locked). The two new columns track how
-- much of that total has been disbursed each direction so far; the
-- contract stays 'held' while any amount remains undisbursed
-- (escrow_amount_cents - escrow_released_cents - escrow_refunded_cents
-- > 0), and moves to a terminal status only once fully settled --
-- 'released' or 'refunded' if it went one direction only (unchanged
-- behavior for the common full-release/full-refund case), or the new
-- 'settled' if the total was split between both.
--
-- Applied directly to Supabase (project tpcriphrfrrgywycviqv) via the
-- Supabase MCP apply_migration tool on 2026-07-31; this file is the git
-- record of that change per supabase/README.md's practice.

ALTER TYPE escrow_status ADD VALUE IF NOT EXISTS 'settled';

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS escrow_released_cents integer NOT NULL DEFAULT 0;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS escrow_refunded_cents integer NOT NULL DEFAULT 0;

-- Extend the existing field-lock trigger to cover the two new columns --
-- same rule as every other escrow field: only service_role (the API
-- handlers) or admin can change them, never a browser-authenticated
-- sponsor/creator directly. Full original function reproduced with the
-- two new OR-branches added, per the "diff against schema-baseline
-- first" practice in supabase/README.md.
CREATE OR REPLACE FUNCTION public.fn_lock_escrow_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  RETURN NEW;
END;
$$;
