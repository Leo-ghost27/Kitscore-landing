-- 2026-08-11, systematic drift audit: comparing every function/trigger
-- live in Supabase against every committed supabase/*.sql file found 37
-- more live objects with zero trace in the repo (on top of the sponsor-
-- reliability system found and fixed on 2026-08-10). This file covers
-- the money/deliverable cluster -- spot-checked for the auth-bypass and
-- wrong-column bug classes already found twice this week; none found
-- here. No logic changes, pure backfill so the repo matches production.

CREATE OR REPLACE FUNCTION public.fn_sync_contract_escrow_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_contract_id uuid := coalesce(new.contract_id, old.contract_id);
  v_total integer;
begin
  select coalesce(sum(amount_cents), 0) into v_total
  from contract_milestones where contract_id = v_contract_id;

  update contracts set escrow_amount_cents = v_total where id = v_contract_id and v_total > 0;
  return coalesce(new, old);
end;
$function$;

DROP TRIGGER IF EXISTS trg_sync_contract_escrow_amount ON public.contract_milestones;
CREATE TRIGGER trg_sync_contract_escrow_amount
  AFTER INSERT OR UPDATE OR DELETE ON public.contract_milestones
  FOR EACH ROW EXECUTE FUNCTION fn_sync_contract_escrow_amount();

CREATE OR REPLACE FUNCTION public.fn_raise_contract_dispute(p_contract_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_contract record;
  v_caller uuid := fn_current_profile_id();
BEGIN
  SELECT * INTO v_contract FROM contracts WHERE id = p_contract_id;

  IF v_contract IS NULL THEN
    RAISE EXCEPTION 'Contract not found';
  END IF;

  IF v_caller != v_contract.sponsor_id AND v_caller != v_contract.creator_id THEN
    RAISE EXCEPTION 'Only the sponsor or creator on this contract can raise a dispute';
  END IF;

  IF v_contract.escrow_status != 'held' THEN
    RAISE EXCEPTION 'Only contracts with funds currently held can be disputed (this one is %)', v_contract.escrow_status;
  END IF;

  IF v_contract.disputed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This contract already has an open dispute';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Please describe the dispute in at least a few words';
  END IF;

  UPDATE contracts
  SET disputed_at = now(), dispute_reason = p_reason, disputed_by = v_caller
  WHERE id = p_contract_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_enforce_deliverable_approval_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_sponsor_plan text;
begin
  if new.requires_approval then
    select s.plan into v_sponsor_plan
    from contracts c join sponsors s on s.id = c.sponsor_id
    where c.id = new.contract_id;

    -- coalesce: a NULL fn_is_admin() (no session, or an authenticated
    -- user with no matching profiles row) must be treated as "not
    -- admin", not silently skip this whole IF like a bare NULL would.
    if v_sponsor_plan is distinct from 'team' and not coalesce(fn_is_admin(), false) then
      raise exception 'Content approval requires the Team plan';
    end if;
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_deliverable_approval_gate ON public.contract_deliverable_items;
CREATE TRIGGER trg_enforce_deliverable_approval_gate
  BEFORE INSERT ON public.contract_deliverable_items
  FOR EACH ROW EXECUTE FUNCTION fn_enforce_deliverable_approval_gate();

CREATE OR REPLACE FUNCTION public.fn_enforce_deliverable_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_sponsor_id uuid;
  v_creator_id uuid;
begin
  select sponsor_id, creator_id into v_sponsor_id, v_creator_id
  from contracts where id = new.contract_id;

  if new.content_status is distinct from old.content_status then
    if new.content_status = 'submitted' then
      if fn_current_profile_id() is distinct from v_creator_id and not fn_is_admin() then
        raise exception 'Only the creator can submit content for review';
      end if;
      if old.content_status not in ('not_submitted','revision_requested') then
        raise exception 'This item is not awaiting submission';
      end if;
      new.content_submitted_at := now();

    elsif new.content_status = 'approved' then
      if fn_current_profile_id() is distinct from v_sponsor_id and not fn_is_admin() then
        raise exception 'Only the sponsor can approve submitted content';
      end if;
      if old.content_status <> 'submitted' then
        raise exception 'Content must be submitted before it can be approved';
      end if;
      new.content_approved_at := now();

    elsif new.content_status = 'revision_requested' then
      if fn_current_profile_id() is distinct from v_sponsor_id and not fn_is_admin() then
        raise exception 'Only the sponsor can request a revision';
      end if;
      if old.content_status <> 'submitted' then
        raise exception 'Only submitted content can have a revision requested';
      end if;
      if old.revision_limit is not null and old.revision_count >= old.revision_limit then
        raise exception 'Revision limit (%) already reached for this item -- approve it or contact Kitscore support to renegotiate', old.revision_limit;
      end if;
      new.revision_count := old.revision_count + 1;

    elsif new.content_status = 'not_submitted' then
      if not fn_is_admin() then
        raise exception 'Content status cannot be reset manually';
      end if;
    end if;
  end if;

  if new.completed_at is not null and old.completed_at is null
     and new.requires_approval and new.content_status <> 'approved' then
    raise exception 'This item requires sponsor approval before it can be marked complete -- submit content for review first';
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_deliverable_review ON public.contract_deliverable_items;
CREATE TRIGGER trg_enforce_deliverable_review
  BEFORE UPDATE ON public.contract_deliverable_items
  FOR EACH ROW EXECUTE FUNCTION fn_enforce_deliverable_review();

CREATE OR REPLACE FUNCTION public.fn_validate_deliverable_item_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;

DROP TRIGGER IF EXISTS trg_validate_deliverable_item_changes ON public.contract_deliverable_items;
CREATE TRIGGER trg_validate_deliverable_item_changes
  BEFORE UPDATE ON public.contract_deliverable_items
  FOR EACH ROW EXECUTE FUNCTION fn_validate_deliverable_item_changes();
