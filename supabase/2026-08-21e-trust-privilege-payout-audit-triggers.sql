-- 2026-08-21e-trust-privilege-payout-audit-triggers.sql
--
-- Four more audit surfaces on top of the contracts trail
-- (2026-08-21d-audit-log-contracts-and-admin-rpc.sql), same append-only
-- audit_log table and fn_admin_audit_log() RPC -- table_name already
-- parameterizes both, so no schema change was needed there.
--
-- 1. TRUST/REPUTATION (campaigns + score_components): the platform's
--    other core promise besides escrow, and the newest fixes from this
--    session's sweep -- least battle-tested, so least trust-worthy to
--    leave unmonitored. Watches the same fields the sweep locked down:
--    status, verified_at, disputed_at, dispute_reason, admin_resolved_at,
--    admin_resolution_note, creator_confirmed, sponsor_confirmed on
--    campaigns. score_components is admin-only to write at all now, so
--    every insert/update there is rare and worth a record on its own,
--    no field filtering needed.
--
-- 2. PRIVILEGE CHANGES (profiles.role, managers/sponsors/teams.plan):
--    profiles.role was the literal admin-escalation hole found this
--    session. Even locked down, a report that fires the instant any
--    role changes to admin, or any plan changes outside a Stripe event,
--    is cheap insurance against the lockdown ever being accidentally
--    loosened by a future migration.
--
-- 3. ADMIN ACTION LOG: admin_actions already exists and is already
--    written to correctly by every real admin handler found
--    (escrow-admin-refund.js, escrow-admin-release.js,
--    billing-admin-refund.js, admin-disputes.html, admin-contracts.html)
--    with real admin_id attribution -- no new trigger needed, this was
--    a reporting-layer addition only (see lib/handlers/cron-audit-
--    exception-report.js and app/admin-audit-log.html). Tightened its
--    grants as defense-in-depth while here: `anon` and `authenticated`
--    both held raw SELECT/INSERT/UPDATE on every column, which would
--    have let anyone fabricate a fake "admin approved this" record or
--    read every dispute/refund note. In practice RLS already fully
--    gated it (single admin_actions_admin_all policy, fn_is_admin() on
--    all commands, confirmed as the only policy on the table) -- not a
--    live exploit, but the same unnecessary-grant hygiene applied to
--    sponsors/creators earlier in this series.
--
-- 4. PAYOUT/STRIPE CONNECT INTEGRITY (creators): stripe_connect_account_id
--    and the charges_enabled/payouts_enabled flags were part of what
--    got locked down from creator self-writes earlier. A report
--    flagging every change here -- especially stripe_connect_account_id
--    changing on an EXISTING (not brand new) creator row, which is the
--    payout-redirection scenario specifically -- is a different failure
--    mode than fake trust scores or fake plan upgrades, worth its own
--    section rather than folding into the others.

REVOKE ALL ON admin_actions FROM authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON admin_actions TO authenticated;

CREATE OR REPLACE FUNCTION fn_audit_campaign_changes()
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
    'status', 'verified_at', 'disputed_at', 'dispute_reason',
    'admin_resolved_at', 'admin_resolution_note',
    'creator_confirmed', 'sponsor_confirmed'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
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
    VALUES ('campaigns', NEW.id, 'update', fn_current_profile_id(), fn_current_role()::text, (SELECT auth.role()), v_changed, v_old, v_new);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_campaign_changes ON public.campaigns;
CREATE TRIGGER trg_audit_campaign_changes
  AFTER UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION fn_audit_campaign_changes();

CREATE OR REPLACE FUNCTION fn_audit_score_components()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (table_name, record_id, action, actor_profile_id, actor_role, db_role, changed_columns, new_values)
    VALUES ('score_components', NEW.id, 'insert', fn_current_profile_id(), fn_current_role()::text, (SELECT auth.role()),
            ARRAY['(row created)'],
            jsonb_build_object('creator_id', NEW.creator_id, 'component_key', NEW.component_key, 'value', NEW.value, 'weight', NEW.weight, 'status', NEW.status));
    RETURN NEW;
  END IF;

  IF NEW.value IS DISTINCT FROM OLD.value OR NEW.weight IS DISTINCT FROM OLD.weight OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO audit_log (table_name, record_id, action, actor_profile_id, actor_role, db_role, changed_columns, old_values, new_values)
    VALUES ('score_components', NEW.id, 'update', fn_current_profile_id(), fn_current_role()::text, (SELECT auth.role()),
            ARRAY['value', 'weight', 'status'],
            jsonb_build_object('value', OLD.value, 'weight', OLD.weight, 'status', OLD.status),
            jsonb_build_object('value', NEW.value, 'weight', NEW.weight, 'status', NEW.status));
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_score_components ON public.score_components;
CREATE TRIGGER trg_audit_score_components
  AFTER INSERT OR UPDATE ON public.score_components
  FOR EACH ROW EXECUTE FUNCTION fn_audit_score_components();

CREATE OR REPLACE FUNCTION fn_audit_role_and_plan_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_col text := TG_ARGV[0];
  v_old jsonb;
  v_new jsonb;
BEGIN
  v_old := to_jsonb(OLD) -> v_col;
  v_new := to_jsonb(NEW) -> v_col;
  IF v_old IS DISTINCT FROM v_new THEN
    INSERT INTO audit_log (table_name, record_id, action, actor_profile_id, actor_role, db_role, changed_columns, old_values, new_values)
    VALUES (TG_TABLE_NAME, NEW.id, 'update', fn_current_profile_id(), fn_current_role()::text, (SELECT auth.role()),
            ARRAY[v_col], jsonb_build_object(v_col, v_old), jsonb_build_object(v_col, v_new));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_profiles_role ON public.profiles;
CREATE TRIGGER trg_audit_profiles_role
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION fn_audit_role_and_plan_changes('role');

DROP TRIGGER IF EXISTS trg_audit_managers_plan ON public.managers;
CREATE TRIGGER trg_audit_managers_plan
  AFTER UPDATE ON public.managers
  FOR EACH ROW EXECUTE FUNCTION fn_audit_role_and_plan_changes('plan');

DROP TRIGGER IF EXISTS trg_audit_sponsors_plan ON public.sponsors;
CREATE TRIGGER trg_audit_sponsors_plan
  AFTER UPDATE ON public.sponsors
  FOR EACH ROW EXECUTE FUNCTION fn_audit_role_and_plan_changes('plan');

DROP TRIGGER IF EXISTS trg_audit_teams_plan ON public.teams;
CREATE TRIGGER trg_audit_teams_plan
  AFTER UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION fn_audit_role_and_plan_changes('plan');

CREATE OR REPLACE FUNCTION fn_audit_creator_payout_changes()
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
    'stripe_connect_account_id', 'stripe_connect_charges_enabled',
    'stripe_connect_payouts_enabled', 'stripe_connect_details_submitted'
  ];
BEGIN
  FOREACH v_col IN ARRAY v_watched LOOP
    IF to_jsonb(NEW) -> v_col IS DISTINCT FROM to_jsonb(OLD) -> v_col THEN
      v_changed := array_append(v_changed, v_col);
      v_old := v_old || jsonb_build_object(v_col, to_jsonb(OLD) -> v_col);
      v_new := v_new || jsonb_build_object(v_col, to_jsonb(NEW) -> v_col);
    END IF;
  END LOOP;

  IF array_length(v_changed, 1) > 0 THEN
    INSERT INTO audit_log (table_name, record_id, action, actor_profile_id, actor_role, db_role, changed_columns, old_values, new_values)
    VALUES ('creators_payout', NEW.id, 'update', fn_current_profile_id(), fn_current_role()::text, (SELECT auth.role()), v_changed, v_old, v_new);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_creator_payout_changes ON public.creators;
CREATE TRIGGER trg_audit_creator_payout_changes
  AFTER UPDATE ON public.creators
  FOR EACH ROW EXECUTE FUNCTION fn_audit_creator_payout_changes();
