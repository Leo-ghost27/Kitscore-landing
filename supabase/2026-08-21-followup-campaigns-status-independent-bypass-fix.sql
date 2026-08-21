-- 2026-08-21-followup-campaigns-status-independent-bypass-fix.sql
--
-- Found continuing the full-schema sweep. campaigns already has a
-- mature set of trigger-based validations (fn_validate_campaign_confirmation,
-- fn_campaign_mutual_confirm, fn_validate_creator_rating,
-- fn_validate_endorsement, fn_validate_creator_endorsement) that
-- correctly guard ratings/endorsements regardless of what else changes
-- in the same statement. Two real gaps found in that same review:
--
-- 1. fn_validate_campaign_confirmation's guard on verified_at/
--    disputed_at/dispute_reason only ran "if new.status is distinct
--    from old.status" -- a party could set verified_at or disputed_at/
--    dispute_reason directly in an UPDATE that left status untouched,
--    and none of the checks fired at all. Same shape as the contracts
--    dispute-field gap, subtler: the validation code already existed,
--    it just wasn't reachable in every case it needed to be. Fixed by
--    making the field-delta checks unconditional, matching how the
--    rating/endorsement triggers already do it correctly, instead of
--    nested inside a status-changed branch.
--
-- 2. admin_resolution_note, admin_resolved_at, and
--    creator_rating_review_status had no guard anywhere and no real
--    write path either -- confirmed via grep across app/*.html,
--    lib/*.js, api/*.js: nothing in this codebase ever writes them.
--    admin-disputes.html resolves a disputed campaign by setting status
--    directly (fn_is_admin() bypasses the trigger, which is correct),
--    not through these columns.
--
--    First attempt at closing #2 was a plain column-level REVOKE --
--    a no-op, same lesson as the managers fix earlier in this series:
--    the grant on campaigns is table-level, and column REVOKE can't
--    narrow a table-level grant you still hold. Given how many real
--    columns on this table are already correctly trigger-guarded,
--    reconstructing the full legitimate-column grant list to fix this
--    via GRANT/REVOKE was higher-risk than just guarding these 3 fields
--    the same way the contracts dispute fields were just fixed --
--    trigger-based, consistent with everything else on this table.

CREATE OR REPLACE FUNCTION public.fn_validate_campaign_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  if fn_is_admin() then
    return new;
  end if;

  if new.admin_resolution_note is distinct from old.admin_resolution_note
     or new.admin_resolved_at is distinct from old.admin_resolved_at
     or new.creator_rating_review_status is distinct from old.creator_rating_review_status then
    raise exception 'These fields can only be changed by a Kitscore admin';
  end if;

  if new.sponsor_confirmed is distinct from old.sponsor_confirmed
     and new.sponsor_id != fn_current_profile_id() then
    raise exception 'Only the sponsor on this campaign can set sponsor_confirmed';
  end if;
  if new.creator_confirmed is distinct from old.creator_confirmed
     and new.creator_id != fn_current_profile_id() then
    raise exception 'Only the creator on this campaign can set creator_confirmed';
  end if;

  -- verified_at: was previously guarded only inside the status-changed
  -- branch below. Made unconditional -- this is the field a party could
  -- otherwise have set directly (e.g. backdating it) by leaving status
  -- untouched in the same statement.
  if new.verified_at is distinct from old.verified_at then
    if not (new.creator_confirmed and new.sponsor_confirmed and new.status = 'verified') then
      raise exception 'verified_at can only be set when both parties have confirmed and status is verified';
    end if;
  end if;

  -- disputed_at / dispute_reason: same fix -- previously only reachable
  -- via the status-changed branch, now checked on their own delta so
  -- leaving status alone in the same call can't bypass them.
  if new.disputed_at is distinct from old.disputed_at or new.dispute_reason is distinct from old.dispute_reason then
    if new.disputed_at is not null and old.disputed_at is null then
      if old.status != 'pending' then
        raise exception 'Only a pending campaign can be disputed';
      end if;
      if new.creator_id != fn_current_profile_id() then
        raise exception 'Only the creator on this campaign can dispute it';
      end if;
      if old.creator_confirmed then
        raise exception 'A campaign you already confirmed cannot be disputed';
      end if;
    elsif new.disputed_at is null and old.disputed_at is not null then
      if fn_current_profile_id() != old.creator_id and fn_current_profile_id() != old.sponsor_id then
        raise exception 'Only the creator or sponsor on this campaign can resolve a dispute';
      end if;
    else
      raise exception 'Invalid dispute field change';
    end if;
  end if;

  -- Status guard. This runs after fn_campaign_mutual_confirm (alphabetically
  -- later trigger name), so new.status already reflects any automatic
  -- pending -> verified transition by the time we see it here.
  if new.status is distinct from old.status then
    if new.status = 'verified' then
      if not (new.creator_confirmed and new.sponsor_confirmed) then
        raise exception 'Campaigns can only become verified once both parties confirm';
      end if;
    elsif new.status = 'disputed' then
      if old.status != 'pending' then
        raise exception 'Only a pending campaign can be disputed';
      end if;
      if new.creator_id != fn_current_profile_id() then
        raise exception 'Only the creator on this campaign can dispute it';
      end if;
      if old.creator_confirmed then
        raise exception 'A campaign you already confirmed cannot be disputed';
      end if;
    elsif new.status = 'pending' and old.status = 'disputed' then
      if new.creator_id != old.creator_id or new.sponsor_id != old.sponsor_id then
        raise exception 'A disputed campaign cannot be reassigned to a different creator or sponsor';
      end if;
      if fn_current_profile_id() != old.creator_id and fn_current_profile_id() != old.sponsor_id then
        raise exception 'Only the creator or sponsor on this campaign can resolve a dispute';
      end if;
      new.dispute_reason := null;
      new.disputed_at := null;
    else
      raise exception 'Invalid campaign status transition';
    end if;
  end if;

  return new;
end;
$function$;
