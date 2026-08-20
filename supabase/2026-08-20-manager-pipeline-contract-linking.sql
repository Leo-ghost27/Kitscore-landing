-- 2026-08-20-manager-pipeline-contract-linking.sql
--
-- Closes the loop between the deal pipeline (2026-08-19) and real
-- contracts. Managers can't create or sign contracts in this app -- that
-- boundary is deliberate (see roster.html copy: "they can never touch
-- your payout details or sign a contract in your place") and is enforced
-- by RLS: contracts has no manager INSERT/UPDATE policy, only
-- contracts_manager_select (fn_is_active_manager_for(creator_id)).
--
-- So instead of a "create contract from this deal" button, this adds
-- LINKING: a manager attaches an already-existing contract (created by
-- the sponsor) to a pipeline card. Once linked, the card shows live
-- contract/escrow status and offers a one-click "sync stage" rather than
-- silently auto-moving the card -- the manager stays in control of what
-- the board says, but doesn't have to hand-type status that already
-- exists elsewhere. A linked contract also automatically shows up on the
-- Finances tab (fn_manager_deal_financials, 2026-08-19) with no separate
-- data entry.

-- One pipeline card per contract -- NULL is allowed to repeat (Postgres
-- unique constraints don't compare NULLs), so unlinked deals are unaffected.
ALTER TABLE manager_deal_pipeline
  ADD CONSTRAINT manager_deal_pipeline_contract_id_key UNIQUE (contract_id);

-- Contracts on this creator that a manager could link to a pipeline card.
-- fn_is_active_manager_for gates it the same way contracts_manager_select
-- already does, so this doesn't grant any new read access, just shapes it
-- for the picker UI. already_linked_to_deal_id lets the client filter out
-- contracts some other pipeline card already claimed (the unique
-- constraint above would reject a double-link anyway; this just keeps
-- them out of the dropdown to begin with).
CREATE OR REPLACE FUNCTION fn_manager_linkable_contracts(p_creator_id uuid)
RETURNS TABLE(
  contract_id uuid,
  title text,
  status text,
  escrow_status text,
  escrow_amount_cents integer,
  deliverable_submitted_at timestamptz,
  released_at timestamptz,
  already_linked_to_deal_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    c.id, c.title, c.status::text, c.escrow_status::text, c.escrow_amount_cents,
    c.deliverable_submitted_at, c.released_at,
    mdp.id
  FROM contracts c
  LEFT JOIN manager_deal_pipeline mdp ON mdp.contract_id = c.id
  WHERE c.creator_id = p_creator_id
    AND fn_is_active_manager_for(c.creator_id)
    AND c.status != 'void'
  ORDER BY c.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION fn_manager_linkable_contracts(uuid) TO authenticated;
