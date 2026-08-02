-- 2026-08-02-contract-deliverable-items.sql
--
-- NOTE ON HISTORY: a `contract_deliverable_items` table already existed
-- live (applied directly to Supabase by a different session earlier
-- the same day, migrations `contract_deliverable_checklist` and
-- `finish_contract_deliverable_items_grants_rls_trigger` -- never
-- committed here as SQL). This file is the reconciliation applied on
-- top of that, NOT a from-scratch CREATE TABLE -- running it against a
-- database that doesn't already have the table will fail. If you're
-- restoring onto a fresh database, create the table first:
--
--   CREATE TABLE contract_deliverable_items (
--     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--     contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
--     description text NOT NULL,
--     sort_order integer NOT NULL DEFAULT 0,
--     completed_at timestamptz,
--     completed_note text,
--     created_at timestamptz NOT NULL DEFAULT now()
--   );
--   ALTER TABLE contract_deliverable_items ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY contract_deliverable_items_select ON contract_deliverable_items FOR SELECT
--     USING (fn_is_admin() OR EXISTS (SELECT 1 FROM contracts c WHERE c.id = contract_deliverable_items.contract_id AND (c.creator_id = fn_current_profile_id() OR c.sponsor_id = fn_current_profile_id())));
--   CREATE POLICY contract_deliverable_items_insert ON contract_deliverable_items FOR INSERT
--     WITH CHECK (EXISTS (SELECT 1 FROM contracts c WHERE c.id = contract_deliverable_items.contract_id AND c.sponsor_id = fn_current_profile_id() AND c.status = 'draft'));
--   CREATE POLICY contract_deliverable_items_update ON contract_deliverable_items FOR UPDATE
--     USING (EXISTS (SELECT 1 FROM contracts c WHERE c.id = contract_deliverable_items.contract_id AND (c.creator_id = fn_current_profile_id() OR c.sponsor_id = fn_current_profile_id())));
--   CREATE POLICY contract_deliverable_items_delete ON contract_deliverable_items FOR DELETE
--     USING (EXISTS (SELECT 1 FROM contracts c WHERE c.id = contract_deliverable_items.contract_id AND c.sponsor_id = fn_current_profile_id() AND c.status = 'draft'));
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_deliverable_items TO anon, authenticated;
--
-- What follows is what actually ran against the live table:

-- Additive column, matches the sponsor-facing checklist builder
-- (e.g. "2x Instagram Story").
ALTER TABLE contract_deliverable_items
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0);

-- Helper used by the submit-deliverable API handler: true when the
-- contract has no checklist items (legacy contract, nothing to gate
-- on) or every item has been checked off.
CREATE OR REPLACE FUNCTION fn_all_deliverable_items_done(p_contract_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM contract_deliverable_items
    WHERE contract_id = p_contract_id AND completed_at IS NULL
  );
$$;

-- Tightens the creator-side branch of the existing trigger: the
-- version applied earlier today let a creator check an item off (or
-- edit its note) at any time. This adds the same two conditions the
-- single "mark whole deliverable as submitted" button already
-- required -- escrow held, and not yet submitted -- so per-item
-- toggling can't get ahead of the overall contract state. Sponsor-side
-- branch (description / sort_order / quantity, draft-only) is
-- unchanged.
CREATE OR REPLACE FUNCTION fn_validate_deliverable_item_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_contract record;
BEGIN
  IF fn_is_admin() OR (SELECT auth.role()) = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_contract FROM contracts WHERE id = NEW.contract_id;

  IF NEW.description IS DISTINCT FROM OLD.description
     OR NEW.sort_order IS DISTINCT FROM OLD.sort_order
     OR NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    IF v_contract.sponsor_id != fn_current_profile_id() OR v_contract.status != 'draft' THEN
      RAISE EXCEPTION 'Deliverable item description/order/quantity can only be edited by the sponsor while the contract is still a draft';
    END IF;
  END IF;

  IF NEW.completed_at IS DISTINCT FROM OLD.completed_at
     OR NEW.completed_note IS DISTINCT FROM OLD.completed_note THEN
    IF v_contract.creator_id != fn_current_profile_id() THEN
      RAISE EXCEPTION 'Only the creator on this contract can mark a deliverable item complete';
    END IF;
    IF v_contract.escrow_status != 'held' THEN
      RAISE EXCEPTION 'Deliverable items can only be checked off while escrow is held';
    END IF;
    IF v_contract.deliverable_submitted_at IS NOT NULL THEN
      RAISE EXCEPTION 'The deliverable has already been submitted -- items are locked';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Cleanup: the earlier session's migrations left two overlapping
-- SELECT policies (identical predicate, admin-check ordered
-- differently) and one overly-broad ALL policy for the creator that
-- duplicated what the command-specific INSERT/UPDATE/DELETE policies
-- already cover -- the trigger above is the real authorization gate
-- for which columns each party can touch, so consolidating these to
-- one policy per command is a no-op behaviorally.
DROP POLICY IF EXISTS contract_deliverable_items_select_involved ON contract_deliverable_items;
DROP POLICY IF EXISTS contract_deliverable_items_creator_write ON contract_deliverable_items;
