-- 2026-08-01-contract-clause-scan.sql
--
-- Creator-side legal protection, part 1 of 2 (part 2 is the creator-
-- facing view of the existing disclosure_scans work, done separately).
-- Nothing today checks contract language for one-sided indemnification
-- terms shifting third-party legal exposure onto the creator -- this is
-- new ground, not an extension of brand_safety_scan or disclosure_scans.
--
-- Deliberately NOT admin-gated like disclosure_scans -- that table hides
-- results from the creator because it's about Kitscore's own trust-score
-- integrity (does the creator's public claim match reality). This is the
-- opposite: it's entirely the creator's own legal exposure, so the
-- creator sees it directly and immediately, at the moment it matters
-- (before signing) -- gating it behind an admin review queue would be
-- actively harmful given the stated urgency (a sponsor could get a
-- signature before Kitscore's admin gets around to reviewing a scan).
--
-- Scan results live directly on the contracts row rather than a separate
-- table (unlike disclosure_scans) because there's exactly one scan that
-- matters per contract -- the current terms -- and contracts already has
-- correct creator/sponsor-visibility RLS (contracts_select_involved) to
-- inherit for free. Columns are added to the same lock-list
-- fn_validate_contract_changes already enforces for other contract
-- fields, so a sponsor or creator can't forge/hide a result via a direct
-- client update -- only the service role (the scan handler) or an admin
-- can write these.
--
-- Applied directly to Supabase (project tpcriphrfrrgywycviqv) via the
-- Supabase MCP apply_migration tool on 2026-08-01; this file is the git
-- record of that change per supabase/README.md's practice.

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS clause_scan_flagged boolean;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS clause_scan_concerns text[];
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS clause_scan_rationale text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS clause_scan_model text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS clause_scanned_at timestamptz;

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
