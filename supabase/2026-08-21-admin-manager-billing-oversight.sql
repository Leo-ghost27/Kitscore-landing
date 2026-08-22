-- 2026-08-21-admin-manager-billing-oversight.sql
--
-- Admin had no visibility into manager plan/subscription state at all --
-- no way to see who's trialing, who's lapsed, comp a trial, force-
-- reactivate a support case, or override the roster cap for a
-- partnership deal. Mirrors the existing admin-sponsors.html /
-- fn_admin_list_sponsor_directory + fn_admin_set_sponsor_restriction
-- pattern. Logs to admin_actions like admin-disputes.html's resolution
-- actions, since a billing override is more consequential than the
-- simpler sponsor-restriction toggle that pattern was built for.

-- Also fixed here: managers_subscription_status_check only allowed
-- 'inactive'/'active'/'cancelled' -- it silently rejected 'trialing',
-- which is exactly what the checkout webhook writes the moment someone
-- actually starts the 14-day trial built earlier today. The entire trial
-- flow would have thrown a constraint violation on its first real use.
-- Widened to the realistic set of Stripe subscription statuses.
ALTER TABLE managers DROP CONSTRAINT managers_subscription_status_check;
ALTER TABLE managers ADD CONSTRAINT managers_subscription_status_check
  CHECK (subscription_status = ANY (ARRAY['inactive'::text, 'trialing'::text, 'active'::text, 'past_due'::text, 'cancelled'::text, 'unpaid'::text]));

CREATE OR REPLACE FUNCTION fn_admin_list_managers()
RETURNS TABLE(
  manager_id uuid, display_name text, email text, agency_name text, plan text,
  subscription_status text, trial_used boolean, trial_ends_at timestamptz,
  roster_active_count integer, staff_count integer, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.display_name, p.email, m.agency_name, m.plan::text, m.subscription_status,
    m.trial_used, m.trial_ends_at,
    COALESCE((SELECT count(*)::integer FROM manager_creator_links mcl WHERE mcl.manager_id = p.id AND mcl.status = 'active'), 0),
    COALESCE((SELECT count(*)::integer FROM agency_staff ags WHERE ags.owner_id = p.id AND ags.status = 'active'), 0),
    p.created_at
  FROM profiles p
  JOIN managers m ON m.id = p.id
  WHERE p.role = 'manager'
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_admin_list_managers() TO authenticated;

CREATE OR REPLACE FUNCTION fn_admin_set_manager_access(
  p_manager_id uuid,
  p_plan text,
  p_subscription_status text,
  p_trial_ends_at timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_admin_id uuid;
BEGIN
  IF NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Admin only';
  END IF;
  IF p_plan NOT IN ('manager', 'agency') THEN
    RAISE EXCEPTION 'Invalid plan: %', p_plan;
  END IF;
  IF p_subscription_status NOT IN ('inactive', 'trialing', 'active', 'past_due', 'cancelled', 'unpaid') THEN
    RAISE EXCEPTION 'Invalid subscription_status: %', p_subscription_status;
  END IF;

  SELECT id INTO v_admin_id FROM profiles WHERE auth_user_id = auth.uid();

  UPDATE managers SET
    plan = p_plan::plan_tier,
    subscription_status = p_subscription_status,
    trial_ends_at = p_trial_ends_at,
    trial_used = trial_used OR (p_subscription_status = 'trialing')
  WHERE id = p_manager_id;

  INSERT INTO admin_actions (admin_id, action_type, target_table, target_id, note)
  VALUES (v_admin_id, 'manager_access_override', 'managers', p_manager_id,
    coalesce(p_note, '') || ' [plan=' || p_plan || ', status=' || p_subscription_status || ']');
END;
$$;

GRANT EXECUTE ON FUNCTION fn_admin_set_manager_access(uuid, text, text, timestamptz, text) TO authenticated;
