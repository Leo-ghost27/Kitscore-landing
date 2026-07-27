-- 2026-07-15e-escrow-payments.sql
--
-- Real payment escrow, built on top of contracts (see
-- 2026-07-15c-briefs-and-contracts.sql). Separate-charges-and-transfers
-- pattern via Stripe Connect: sponsor's payment lands in the PLATFORM's
-- Stripe balance first (not the creator's), held until the sponsor
-- explicitly approves release, at which point a Transfer moves funds
-- (minus platform fee) to the creator's own Stripe Express account.
--
-- Deliberately NOT using Stripe Checkout's transfer_data/destination-charge
-- shortcut -- that pattern sends funds to the connected account
-- immediately as part of the same charge, which is NOT escrow (nothing
-- would be held back pending approval). This is the slower, two-step
-- version on purpose.
--
-- All escrow_* fields on contracts are locked to the service_role only
-- (see trigger below) -- no amount of client-side RLS policy tuning
-- makes it safe for a browser-authenticated user to directly flip their
-- own contract to escrow_status='released'. Every mutation to these
-- fields must go through api/escrow.js, which uses the service-role
-- Supabase client and the real Stripe API as the actual source of truth.

-- ── Creator payout accounts (Stripe Connect Express) ────────────────────────
ALTER TABLE creators ADD COLUMN IF NOT EXISTS stripe_connect_account_id text;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS stripe_connect_details_submitted boolean NOT NULL DEFAULT false;

-- ── Escrow on contracts ──────────────────────────────────────────────────
CREATE TYPE escrow_status AS ENUM ('not_funded', 'processing', 'held', 'released', 'refunded', 'failed');

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS escrow_amount_cents integer;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS platform_fee_cents integer;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS escrow_status escrow_status NOT NULL DEFAULT 'not_funded';
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS escrow_payment_intent_id text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS escrow_charge_id text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS escrow_transfer_id text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS funded_at timestamptz;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS released_at timestamptz;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS deliverable_submitted_at timestamptz;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS deliverable_notes text;

-- Locks every escrow-adjacent field to the service role (or admin), with
-- one exception: escrow_amount_cents may still be set/changed by either
-- party while the contract is still a 'draft' (same as any other term --
-- mirrors fn_validate_contract_changes' own pre-send editability). Once
-- sent, escrow_amount_cents joins the rest of the locked fields.
--
-- Runs BEFORE fn_validate_contract_changes in trigger name order
-- (fn_lock < fn_validate alphabetically), so a disallowed escrow-field
-- change is rejected here before that trigger's term-lock logic even
-- gets a chance to run.
CREATE OR REPLACE FUNCTION fn_lock_escrow_fields()
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
     OR NEW.deliverable_submitted_at IS DISTINCT FROM OLD.deliverable_submitted_at THEN
    RAISE EXCEPTION 'Escrow fields can only be changed by the payments system';
  END IF;

  IF OLD.status != 'draft' AND NEW.escrow_amount_cents IS DISTINCT FROM OLD.escrow_amount_cents THEN
    RAISE EXCEPTION 'Escrow fields can only be changed by the payments system';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fn_lock_escrow_fields
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION fn_lock_escrow_fields();
