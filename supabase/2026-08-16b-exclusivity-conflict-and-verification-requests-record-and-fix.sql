-- 2026-08-16b-exclusivity-conflict-and-verification-requests-record-and-fix.sql
--
-- This file has two jobs:
--
-- 1. RETROACTIVE RECORD. The exclusivity_conflict_* columns on contracts
--    and the verification_requests table were already applied directly to
--    Supabase (migration 20260816071936, add_exclusivity_conflict_scan_and_
--    verification_requests) without a matching .sql file ever being
--    committed to this repo -- the exact "RLS/schema changes applied
--    directly to production without a migration file" gap this workspace
--    has a standing rule against. Everything below marked RETROACTIVE
--    matches the live schema exactly as introspected on 2026-08-16 and
--    changes nothing; it's git history catching up to what's already
--    running, per supabase/README.md's practice for direct-apply changes.
--
-- 2. AN ACTUAL FIX. The retroactively-recorded change added
--    exclusivity_conflict_* columns to contracts but did NOT extend
--    fn_validate_contract_changes() to lock them the way clause_scan_*
--    is locked (see 2026-08-01-contract-clause-scan.sql for that
--    precedent and its reasoning). That gap meant a creator or sponsor
--    with ordinary UPDATE access to their own contract row could forge
--    or silently clear a real exclusivity-conflict flag via a direct
--    API call -- the same class of hole 2026-08-12-scope-fully-signed-
--    void.sql closed for contract voiding. The updated trigger function
--    below is the real fix and was applied live via the Supabase MCP
--    apply_migration tool before this file was written.

-- ---------- RETROACTIVE: exclusivity conflict columns on contracts ----------
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS exclusivity_conflict_flagged boolean;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS exclusivity_conflict_concerns text[];
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS exclusivity_conflict_rationale text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS exclusivity_conflict_model text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS exclusivity_conflict_scanned_at timestamptz;

-- ---------- RETROACTIVE: verification_requests table ----------
-- Sponsor-initiated: "I want to see this creator verified before I
-- decide." target_creator_id is set when target_email matches an
-- existing creator's business_email (see
-- lib/handlers/request-verification.js); null means it's an invite-to-
-- claim for someone not yet on Kitscore, same email-first pattern as
-- sponsor-invite-creator.js.
CREATE TABLE IF NOT EXISTS verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  target_creator_id uuid REFERENCES creators(id) ON DELETE SET NULL,
  target_email text NOT NULL,
  target_context text,
  status text NOT NULL DEFAULT 'sent' CHECK (status = ANY (ARRAY['sent'::text, 'claimed'::text, 'verified'::text, 'expired'::text])),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

ALTER TABLE verification_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "sponsors manage their own verification requests" ON verification_requests
    FOR ALL
    USING (sponsor_id = (SELECT sponsors.id FROM sponsors WHERE sponsors.id = auth.uid()))
    WITH CHECK (sponsor_id = (SELECT sponsors.id FROM sponsors WHERE sponsors.id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "targeted creators can view requests naming them" ON verification_requests
    FOR SELECT
    USING (target_creator_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "admins manage all verification requests" ON verification_requests
    FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'::user_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- FIX: lock exclusivity_conflict_* the same way clause_scan_* is locked ----------
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

  if new.exclusivity_conflict_flagged is distinct from old.exclusivity_conflict_flagged
     or new.exclusivity_conflict_concerns is distinct from old.exclusivity_conflict_concerns
     or new.exclusivity_conflict_rationale is distinct from old.exclusivity_conflict_rationale
     or new.exclusivity_conflict_model is distinct from old.exclusivity_conflict_model
     or new.exclusivity_conflict_scanned_at is distinct from old.exclusivity_conflict_scanned_at then
    raise exception 'Exclusivity conflict check results can only be set by the scanning system';
  end if;

  if new.status = 'void' and old.status != 'void' then
    if new.sponsor_id != fn_current_profile_id() then
      raise exception 'Only the sponsor on this contract can void it';
    end if;
    if old.status = 'fully_signed' then
      if old.disputed_at is null or old.admin_resolved_at is not null then
        raise exception 'A fully signed contract can only be voided while Kitscore has an active flag on it -- contact support to resolve this another way';
      end if;
      if old.escrow_status != 'not_funded' then
        raise exception 'This contract has funded escrow -- resolve that through Escrow Oversight before voiding';
      end if;
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
