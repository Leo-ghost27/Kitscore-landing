-- 2026-08-02b-contract-deliverable-items.sql
--
-- Turns the deliverable-submission flow from "one free-text field plus
-- a single mark-as-submitted button" into an actual checklist.
--
-- `contracts.deliverables` stays as-is -- it's still the human-readable
-- overview shown in the contract terms (e.g. "1 dedicated YouTube video,
-- 2 Instagram Stories"). This migration adds a companion table of
-- individual, independently-trackable line items (e.g. "1 Reel", "1
-- Story", "Usage rights confirmation") that the creator checks off one
-- at a time, instead of a single opaque confirmation.
--
-- Contracts drafted before this migration simply have zero rows here --
-- the app falls back to the old single-button flow for those so nothing
-- existing breaks (see fn_all_deliverable_items_done below and the
-- app-side gating in contracts.html / escrow-submit-deliverable.js).

CREATE TABLE contract_deliverable_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  sort_order integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  completed_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_contract_deliverable_items_contract ON contract_deliverable_items(contract_id);

-- Helper used by the submit-deliverable API handler: true when either
-- the contract has no checklist items (legacy contract, nothing to
-- gate on) or every item on it has been checked off.
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

-- Write rules, mirroring the term-lock pattern already used on
-- `contracts` (fn_validate_contract_changes):
--   * Sponsor may insert/delete/edit description+quantity only while
--     the parent contract is still a draft.
--   * Creator may only flip completed_at/completed_notes, only while
--     escrow is held, and only before the overall deliverable has been
--     marked submitted -- matching the existing single-button gating
--     (contracts.escrow_status = 'held' AND deliverable_submitted_at IS
--     NULL) so per-item checking can't outrun the overall state.
CREATE OR REPLACE FUNCTION fn_validate_deliverable_item_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_contract contracts%ROWTYPE;
  v_row contract_deliverable_items%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) = 'service_role' OR fn_is_admin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_row := COALESCE(NEW, OLD);
  SELECT * INTO v_contract FROM contracts WHERE id = v_row.contract_id;
  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Contract not found';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF v_contract.creator_id = fn_current_profile_id() THEN
      IF NEW.description IS DISTINCT FROM OLD.description
         OR NEW.quantity IS DISTINCT FROM OLD.quantity
         OR NEW.sort_order IS DISTINCT FROM OLD.sort_order
         OR NEW.contract_id IS DISTINCT FROM OLD.contract_id THEN
        RAISE EXCEPTION 'Only the sponsor can edit a checklist item''s description or quantity';
      END IF;
      IF v_contract.escrow_status != 'held' THEN
        RAISE EXCEPTION 'Deliverable items can only be checked off while escrow is held';
      END IF;
      IF v_contract.deliverable_submitted_at IS NOT NULL THEN
        RAISE EXCEPTION 'The deliverable has already been submitted -- items are locked';
      END IF;
      RETURN NEW;
    ELSIF v_contract.sponsor_id = fn_current_profile_id() THEN
      IF v_contract.status != 'draft' THEN
        RAISE EXCEPTION 'Checklist items are locked once the contract is sent -- void and redraft to change them';
      END IF;
      RETURN NEW;
    ELSE
      RAISE EXCEPTION 'Not authorized to update this checklist item';
    END IF;
  END IF;

  -- INSERT / DELETE: sponsor only, only while the contract is a draft.
  IF v_contract.sponsor_id != fn_current_profile_id() THEN
    RAISE EXCEPTION 'Only the sponsor on this contract can manage its checklist items';
  END IF;
  IF v_contract.status != 'draft' THEN
    RAISE EXCEPTION 'Checklist items are locked once the contract is sent -- void and redraft to change them';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_validate_deliverable_item_insert
  BEFORE INSERT ON contract_deliverable_items
  FOR EACH ROW EXECUTE FUNCTION fn_validate_deliverable_item_write();

CREATE TRIGGER trg_validate_deliverable_item_update
  BEFORE UPDATE ON contract_deliverable_items
  FOR EACH ROW EXECUTE FUNCTION fn_validate_deliverable_item_write();

CREATE TRIGGER trg_validate_deliverable_item_delete
  BEFORE DELETE ON contract_deliverable_items
  FOR EACH ROW EXECUTE FUNCTION fn_validate_deliverable_item_write();

ALTER TABLE contract_deliverable_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY contract_deliverable_items_select ON contract_deliverable_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM contracts c
    WHERE c.id = contract_deliverable_items.contract_id
      AND (c.sponsor_id = fn_current_profile_id() OR c.creator_id = fn_current_profile_id() OR fn_is_admin())
  ));

CREATE POLICY contract_deliverable_items_insert ON contract_deliverable_items FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM contracts c
    WHERE c.id = contract_deliverable_items.contract_id
      AND (c.sponsor_id = fn_current_profile_id() OR fn_is_admin())
  ));

CREATE POLICY contract_deliverable_items_update ON contract_deliverable_items FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM contracts c
    WHERE c.id = contract_deliverable_items.contract_id
      AND (c.sponsor_id = fn_current_profile_id() OR c.creator_id = fn_current_profile_id() OR fn_is_admin())
  ));

CREATE POLICY contract_deliverable_items_delete ON contract_deliverable_items FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM contracts c
    WHERE c.id = contract_deliverable_items.contract_id
      AND (c.sponsor_id = fn_current_profile_id() OR fn_is_admin())
  ));

-- Every other table in this schema grants base privileges to
-- anon/authenticated and relies entirely on RLS as the real gate (see
-- 2026-07-07-grant-clients-table-privileges.sql for the bug that
-- happens when this step gets skipped).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_deliverable_items TO anon, authenticated;
