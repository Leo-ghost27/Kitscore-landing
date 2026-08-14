-- 2026-08-10-pitch-evidence-logging.sql
--
-- Idea/pitch theft protection: creators report brands extracting a
-- pitch's creative concept during brief discussions, then ghosting and
-- reusing the idea with someone cheaper (or in-house). Nothing today
-- proves what a creator actually submitted, or when -- brief_applications
-- .pitch_message is a plain editable text field with no timestamp
-- integrity.
--
-- This is a lightweight extension of the existing briefs/applications
-- flow (2026-07-15c-briefs-and-contracts.sql), not a new subsystem --
-- same "lock a field once written, only service role/admin can touch
-- it" pattern as clause_scan_* on contracts
-- (2026-08-01-contract-clause-scan.sql).
--
-- Design:
--   - pitch_hash: sha256(brief_id || creator_id || pitch_message ||
--     locked timestamp), computed server-side by the DB itself at
--     INSERT time via pgcrypto's digest() -- not something a client
--     could forge, since it's set inside the trigger, not passed in.
--   - pitch_locked_at: the moment the hash was computed. Doubles as
--     the "this pitch existed at time X" proof.
--   - Once set, pitch_message/pitch_hash/pitch_locked_at become
--     immutable for both parties -- a creator can't inflate a pitch
--     after a dispute, and a sponsor can't claim a different pitch was
--     sent. Symmetric protection, same reasoning as
--     fn_validate_contract_changes locking contract terms once sent.
--   - No new table: reuses brief_applications' existing RLS
--     (creator sees their own; sponsor sees applications to their own
--     briefs; admin sees all) -- both parties on an application can
--     already see pitch_message, so they can see its hash/timestamp
--     too. This is a deterrent BY BOTH PARTIES SEEING IT, not a
--     one-sided surveillance log.
--
-- Applied directly to Supabase (project tpcriphrfrrgywycviqv) via the
-- Supabase MCP apply_migration tool; this file is the git record per
-- supabase/README.md's practice.

-- gen_random_uuid() is already used as a column default throughout the
-- schema, which confirms pgcrypto is available -- this just makes the
-- dependency for digest() explicit rather than assumed.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE brief_applications ADD COLUMN IF NOT EXISTS pitch_hash text;
ALTER TABLE brief_applications ADD COLUMN IF NOT EXISTS pitch_locked_at timestamptz;

-- Replaces the INSERT-only validator from 2026-07-15c with one that
-- also runs on UPDATE, so the same function can both (a) stamp the
-- hash/timestamp at insert and (b) lock those fields plus
-- pitch_message from any later change.
CREATE OR REPLACE FUNCTION public.fn_validate_brief_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_brief_status brief_status;
  v_brief_sponsor uuid;
begin
  if tg_op = 'INSERT' then
    select status, sponsor_id into v_brief_status, v_brief_sponsor
    from campaign_briefs where id = new.brief_id;

    if v_brief_status is distinct from 'open' then
      raise exception 'This brief is no longer accepting applications';
    end if;
    if v_brief_sponsor = new.creator_id then
      raise exception 'A sponsor account cannot apply to its own brief';
    end if;

    -- Server-computed, tamper-evident timestamp + hash. Client-supplied
    -- pitch_hash/pitch_locked_at (if any) are ignored on purpose.
    new.pitch_locked_at := now();
    new.pitch_hash := encode(
      digest(
        coalesce(new.brief_id::text, '') || '|' ||
        coalesce(new.creator_id::text, '') || '|' ||
        coalesce(new.pitch_message, '') || '|' ||
        new.pitch_locked_at::text,
        'sha256'
      ),
      'hex'
    );

    return new;
  end if;

  -- tg_op = 'UPDATE'
  if fn_is_admin() or (select auth.role()) = 'service_role' then
    return new;
  end if;

  if new.pitch_message is distinct from old.pitch_message
     or new.pitch_hash is distinct from old.pitch_hash
     or new.pitch_locked_at is distinct from old.pitch_locked_at then
    raise exception 'A submitted pitch is locked evidence and cannot be edited';
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_validate_brief_application ON brief_applications;
CREATE TRIGGER trg_validate_brief_application
  BEFORE INSERT OR UPDATE ON brief_applications
  FOR EACH ROW EXECUTE FUNCTION fn_validate_brief_application();
