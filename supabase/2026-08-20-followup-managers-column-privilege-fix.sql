-- 2026-08-20-followup-managers-column-privilege-fix.sql
--
-- Found during a review of whether the Agency-tier server-side
-- enforcement gap (f1bc3be) was fully closed. It was, at the RPC/RLS
-- level -- but one hole underneath all of it was still open.
--
-- managers_update_own RLS only checks row ownership
-- (id = fn_current_profile_id()), never which columns changed. That's
-- normal and fine *if* column-level GRANTs also restrict what a
-- non-admin can touch. They didn't: `authenticated` held table-level
-- UPDATE on the whole managers row, including plan, stripe_customer_id,
-- subscription_status, trial_used, and trial_ends_at. Any logged-in
-- manager could self-elevate to Agency for free with:
--   sb.from('managers').update({ plan: 'agency' }).eq('id', profile.id)
-- ...silently defeating every fn_manager_is_agency() check added in
-- f1bc3be, since they all just read this column back.
--
-- The comment already in app/profile-manager.html ("plan is
-- intentionally not sent here -- it's column-locked to service_role
-- only") described the intended state, not the actual one -- confirmed
-- via information_schema.column_privileges before touching anything;
-- not exploited against production to "prove" it.
--
-- First attempt (in-session, superseded by this file) tried a plain
-- column-level REVOKE UPDATE (col list) and was a no-op: the existing
-- grant was whole-table, and column REVOKE can't narrow a table-level
-- grant you still hold. Correct fix is below -- revoke the table grant
-- entirely, then re-grant UPDATE on only the columns a manager should
-- touch directly.
REVOKE UPDATE ON public.managers FROM authenticated;
GRANT UPDATE (agency_name, logo_url, updated_at) ON public.managers TO authenticated;

-- Branding (agency_name/logo_url) itself had no plan check anywhere --
-- despite being called out elsewhere as "already right" alongside Rate
-- Benchmark. No trigger existed. A Manager-tier account could set
-- white-label branding directly. Fixed with a trigger instead of an
-- RPC gate since these are plain column writes, not RPC calls -- a
-- manager can still clear branding to null (e.g. after a downgrade),
-- just can't set a real value without the Agency plan.
CREATE OR REPLACE FUNCTION fn_managers_guard_branding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF (NEW.agency_name IS NOT NULL OR NEW.logo_url IS NOT NULL)
     AND (NEW.agency_name IS DISTINCT FROM OLD.agency_name OR NEW.logo_url IS DISTINCT FROM OLD.logo_url)
     AND OLD.plan IS DISTINCT FROM 'agency'
     AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Agency branding requires the Agency plan';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_managers_guard_branding ON public.managers;
CREATE TRIGGER trg_managers_guard_branding
  BEFORE UPDATE ON public.managers
  FOR EACH ROW EXECUTE FUNCTION fn_managers_guard_branding();

-- Verified post-fix: authenticated's UPDATE columns on managers are now
-- exactly {agency_name, logo_url, updated_at}. service_role (Stripe
-- webhook) and postgres retain all 10 columns, unaffected.
