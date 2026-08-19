-- Manager-submission tracking + audit-safe revoke archive
-- Context: brief_applications and evidence_uploads had no way to tell
-- whether a row was submitted by the creator themselves or by a linked
-- manager acting on their behalf (both write via the same creator_id,
-- RLS-gated by fn_is_active_manager_for). That made it impossible to
-- selectively clean up only manager-submitted, still-pending items on
-- revoke without either wiping the creator's own pending work too, or
-- doing nothing. This adds server-stamped attribution (via trigger, not
-- client-reported, so it can't be spoofed) plus an archive table so any
-- data removed from the creator's active view on revoke is still
-- retrievable for a dispute or audit -- nothing is ever hard-deleted.

-- 1. Attribution columns ------------------------------------------------
ALTER TABLE brief_applications ADD COLUMN IF NOT EXISTS submitted_via_manager_id uuid REFERENCES managers(id);
ALTER TABLE evidence_uploads ADD COLUMN IF NOT EXISTS submitted_via_manager_id uuid REFERENCES managers(id);

-- 2. Trigger: server-side, not client-reported ---------------------------
-- Stamps submitted_via_manager_id when the inserting user is an active
-- manager for NEW.creator_id. Runs regardless of what the client sends.
CREATE OR REPLACE FUNCTION fn_stamp_manager_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manager_id uuid;
BEGIN
  SELECT m.id INTO v_manager_id
  FROM managers m
  JOIN profiles p ON p.id = m.id
  JOIN manager_creator_links l ON l.manager_id = m.id
  WHERE p.auth_user_id = auth.uid()
    AND l.creator_id = NEW.creator_id
    AND l.status = 'active'
  LIMIT 1;

  IF v_manager_id IS NOT NULL THEN
    NEW.submitted_via_manager_id := v_manager_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_manager_brief_application ON brief_applications;
CREATE TRIGGER trg_stamp_manager_brief_application
  BEFORE INSERT ON brief_applications
  FOR EACH ROW EXECUTE FUNCTION fn_stamp_manager_submission();

DROP TRIGGER IF EXISTS trg_stamp_manager_evidence_upload ON evidence_uploads;
CREATE TRIGGER trg_stamp_manager_evidence_upload
  BEFORE INSERT ON evidence_uploads
  FOR EACH ROW EXECUTE FUNCTION fn_stamp_manager_submission();

-- 3. Archive table --------------------------------------------------------
-- Full row payload preserved as jsonb. Nothing in this flow ever runs a
-- hard DELETE without first writing a copy here.
CREATE TABLE IF NOT EXISTS manager_revoke_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table text NOT NULL,
  source_id uuid NOT NULL,
  creator_id uuid NOT NULL REFERENCES creators(id),
  manager_id uuid NOT NULL REFERENCES managers(id),
  reason text NOT NULL DEFAULT 'manager_revoked',
  payload jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE manager_revoke_archive ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY manager_revoke_archive_creator_select ON manager_revoke_archive
    FOR SELECT USING (
      creator_id IN (SELECT id FROM creators WHERE id = (SELECT id FROM profiles WHERE auth_user_id = auth.uid()))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY manager_revoke_archive_admin_select ON manager_revoke_archive
    FOR SELECT USING (
      EXISTS (SELECT 1 FROM profiles WHERE auth_user_id = auth.uid() AND role = 'admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Revoke + archive RPC --------------------------------------------------
-- Only touches rows that are BOTH submitted by this specific manager AND
-- still unacted-upon (brief_applications.status = 'pending', or
-- evidence_uploads.status in ('self_reported','submitted') -- i.e. not
-- yet live_verified or rejected). Anything already acted on (shortlisted,
-- accepted, rejected, verified, or attached to a signed contract) is left
-- completely alone -- this only clears out the in-flight leftovers, never
-- a completed transaction.
CREATE OR REPLACE FUNCTION fn_revoke_manager_and_archive(p_link_id uuid)
RETURNS TABLE(archived_brief_applications int, archived_evidence_uploads int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator_id uuid;
  v_manager_id uuid;
  v_caller_creator_id uuid;
  v_brief_count int := 0;
  v_evidence_count int := 0;
  r record;
BEGIN
  SELECT creator_id, manager_id INTO v_creator_id, v_manager_id
  FROM manager_creator_links WHERE id = p_link_id;

  IF v_creator_id IS NULL THEN
    RAISE EXCEPTION 'Manager link not found';
  END IF;

  SELECT id INTO v_caller_creator_id FROM profiles WHERE auth_user_id = auth.uid();
  IF v_caller_creator_id IS NULL OR v_caller_creator_id <> v_creator_id THEN
    RAISE EXCEPTION 'Not your manager link';
  END IF;

  -- Archive + remove pending brief_applications submitted by this manager
  FOR r IN
    SELECT * FROM brief_applications
    WHERE creator_id = v_creator_id
      AND submitted_via_manager_id = v_manager_id
      AND status = 'pending'
  LOOP
    INSERT INTO manager_revoke_archive (source_table, source_id, creator_id, manager_id, payload)
    VALUES ('brief_applications', r.id, v_creator_id, v_manager_id, to_jsonb(r));
    DELETE FROM brief_applications WHERE id = r.id;
    v_brief_count := v_brief_count + 1;
  END LOOP;

  -- Archive + remove not-yet-reviewed evidence_uploads submitted by this manager
  FOR r IN
    SELECT * FROM evidence_uploads
    WHERE creator_id = v_creator_id
      AND submitted_via_manager_id = v_manager_id
      AND status IN ('self_reported', 'submitted')
  LOOP
    INSERT INTO manager_revoke_archive (source_table, source_id, creator_id, manager_id, payload)
    VALUES ('evidence_uploads', r.id, v_creator_id, v_manager_id, to_jsonb(r));
    DELETE FROM evidence_uploads WHERE id = r.id;
    v_evidence_count := v_evidence_count + 1;
  END LOOP;

  UPDATE manager_creator_links
  SET status = 'revoked', revoked_at = now()
  WHERE id = p_link_id;

  RETURN QUERY SELECT v_brief_count, v_evidence_count;
END;
$$;
