-- 2026-08-21d-audit-log-contracts-and-admin-rpc.sql
--
-- Paper trail for the most consequential fields on the platform:
-- escrow money movement and dispute/admin-resolution on contracts --
-- the exact fields this session's sweep found and locked down from
-- client tampering (2026-08-21-followup-contracts-dispute-fields-
-- trigger-guard.sql). This is the human-facing "who did what, when"
-- record for that same surface, not a new access-control layer.
--
-- Design notes:
-- - Append-only by convention: no UPDATE/DELETE policy exists for
--   anyone, including admin. Rows are written only by the trigger
--   function (SECURITY DEFINER, bypasses RLS regardless of policy).
--   Admins get read-only access via GRANT SELECT + an admin-gated RLS
--   policy.
-- - actor_profile_id is fn_current_profile_id() -- null whenever the
--   change came from a service-role call (a webhook, an admin API
--   handler using adminClient(), a cron job). That's itself useful
--   signal: a null actor on an escrow_status change means "trust the
--   API layer's own auth for who authorized this, not RLS" -- exactly
--   the escrow-fund.js/escrow-release.js/etc. pattern verified earlier
--   in this session (getAuthedSponsor/getAuthedCreator, then
--   adminClient()). db_role (auth.role()) is captured alongside
--   actor_role to distinguish "no user session at all" (service_role)
--   from other cases.
-- - old_values/new_values store only the columns that actually
--   changed, not full-row snapshots -- keeps rows small and diffs
--   readable.
-- - AFTER trigger, not BEFORE: this only records what actually got
--   committed. fn_lock_escrow_fields (BEFORE UPDATE, already in place)
--   is the enforcement layer; this is the record of what it let
--   through.

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action = ANY (ARRAY['insert'::text, 'update'::text])),
  actor_profile_id uuid,
  actor_role text,
  db_role text NOT NULL,
  changed_columns text[] NOT NULL DEFAULT '{}',
  old_values jsonb,
  new_values jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_table_record ON audit_log(table_name, record_id, occurred_at DESC);
CREATE INDEX idx_audit_log_occurred_at ON audit_log(occurred_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_admin_read ON audit_log
  FOR SELECT
  USING (fn_is_admin());

REVOKE ALL ON audit_log FROM authenticated, anon;
GRANT SELECT ON audit_log TO authenticated;

CREATE OR REPLACE FUNCTION fn_audit_contract_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_changed text[] := '{}';
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_col text;
  v_watched text[] := ARRAY[
    'status', 'escrow_status', 'escrow_amount_cents', 'escrow_released_cents',
    'escrow_refunded_cents', 'funded_at', 'released_at', 'refunded_at',
    'disputed_at', 'disputed_by', 'dispute_reason',
    'admin_resolved_at', 'admin_resolution_note'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (table_name, record_id, action, actor_profile_id, actor_role, db_role, changed_columns, new_values)
    VALUES ('contracts', NEW.id, 'insert', fn_current_profile_id(), fn_current_role()::text, (SELECT auth.role()),
            ARRAY['(row created)'],
            jsonb_build_object('sponsor_id', NEW.sponsor_id, 'creator_id', NEW.creator_id, 'title', NEW.title, 'escrow_amount_cents', NEW.escrow_amount_cents));
    RETURN NEW;
  END IF;

  FOREACH v_col IN ARRAY v_watched LOOP
    IF to_jsonb(NEW) -> v_col IS DISTINCT FROM to_jsonb(OLD) -> v_col THEN
      v_changed := array_append(v_changed, v_col);
      v_old := v_old || jsonb_build_object(v_col, to_jsonb(OLD) -> v_col);
      v_new := v_new || jsonb_build_object(v_col, to_jsonb(NEW) -> v_col);
    END IF;
  END LOOP;

  IF array_length(v_changed, 1) > 0 THEN
    INSERT INTO audit_log (table_name, record_id, action, actor_profile_id, actor_role, db_role, changed_columns, old_values, new_values)
    VALUES ('contracts', NEW.id, 'update', fn_current_profile_id(), fn_current_role()::text, (SELECT auth.role()), v_changed, v_old, v_new);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_contract_changes ON public.contracts;
CREATE TRIGGER trg_audit_contract_changes
  AFTER INSERT OR UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION fn_audit_contract_changes();

-- Admin-facing read RPC, joining in a human-readable actor name. This
-- is for a real logged-in admin session (the admin-audit-log.html
-- browser page) -- the weekly cron report queries audit_log directly
-- instead, same reasoning cron-health-check.js already documents: this
-- RPC's admin gate checks auth.uid(), which is null for a service-role
-- cron call, so it would reject itself.
CREATE OR REPLACE FUNCTION fn_admin_audit_log(p_days integer DEFAULT 30, p_table_name text DEFAULT NULL)
RETURNS TABLE(
  id uuid, table_name text, record_id uuid, action text,
  actor_name text, actor_role text, db_role text,
  changed_columns text[], old_values jsonb, new_values jsonb, occurred_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    a.id, a.table_name, a.record_id, a.action,
    p.display_name, a.actor_role, a.db_role,
    a.changed_columns, a.old_values, a.new_values, a.occurred_at
  FROM audit_log a
  LEFT JOIN profiles p ON p.id = a.actor_profile_id
  WHERE fn_is_admin()
    AND a.occurred_at > now() - (p_days || ' days')::interval
    AND (p_table_name IS NULL OR a.table_name = p_table_name)
  ORDER BY a.occurred_at DESC
  LIMIT 500;
$$;

GRANT EXECUTE ON FUNCTION fn_admin_audit_log(integer, text) TO authenticated;
