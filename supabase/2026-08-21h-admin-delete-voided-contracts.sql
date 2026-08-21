-- admin_delete_voided_contracts
--
-- Standing open item: no delete path existed anywhere for contracts,
-- including in the admin panel -- void just sets status='void' and
-- leaves the row. This adds one, scoped narrowly on purpose: only
-- status='void' contracts are deletable, only by an admin, and every
-- delete is logged to admin_actions (with a snapshot of the contract in
-- metadata, since the row itself won't exist to look up afterward).
--
-- Went through contracts' FK dependents (checked live via
-- information_schema, not assumed) before deciding what this needs to
-- handle:
--   contract_deliverable_items, contract_milestones,
--   notification_failures, manager_deal_financials -- ON DELETE CASCADE
--   already, nothing to do.
--   manager_deal_pipeline, manager_issue_log -- ON DELETE SET NULL
--   already, nothing to do.
--   creator_contract_invites.created_contract_id -- ON DELETE NO ACTION,
--   which would otherwise block the delete outright. Nulled out
--   explicitly below rather than altering the FK, since the invite
--   record itself (who invited whom, when) is still meaningful history
--   even once the contract it produced is gone.
--
-- SECURITY DEFINER so it can do the FK cleanup + audit insert + delete
-- as one atomic unit; GRANT EXECUTE to authenticated broadly since the
-- fn_is_admin() check inside is the actual gate, same pattern as
-- fn_accept_team_invite.

CREATE OR REPLACE FUNCTION fn_admin_delete_voided_contract(p_contract_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_contract contracts;
  v_admin_id uuid := fn_current_profile_id();
BEGIN
  IF NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'A note is required';
  END IF;

  SELECT * INTO v_contract FROM contracts WHERE id = p_contract_id;
  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Contract not found';
  END IF;
  IF v_contract.status <> 'void' THEN
    RAISE EXCEPTION 'Only voided contracts can be deleted -- this one is %', v_contract.status;
  END IF;

  UPDATE creator_contract_invites SET created_contract_id = NULL WHERE created_contract_id = p_contract_id;

  INSERT INTO admin_actions (admin_id, action_type, target_table, target_id, note, metadata)
  VALUES (
    v_admin_id, 'contract_deleted', 'contracts', p_contract_id, p_note,
    jsonb_build_object(
      'title', v_contract.title,
      'sponsor_id', v_contract.sponsor_id,
      'creator_id', v_contract.creator_id,
      'status', v_contract.status,
      'created_at', v_contract.created_at
    )
  );

  DELETE FROM contracts WHERE id = p_contract_id;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_admin_delete_voided_contract(uuid, text) TO authenticated;
