-- sponsors_insert_privilege_fix_CRITICAL
--
-- 2026-08-21-sponsors-column-privilege-fix.sql closed the UPDATE vector
-- on sponsors but never touched INSERT. INSERT was still granted on
-- every column to both authenticated AND anon, and sponsors_owner_only's
-- WITH CHECK only verifies id = fn_current_profile_id() -- nothing
-- restricts which columns a self-inserted row can set. Same exposure the
-- UPDATE fix described: plan, reliability_score, campaigns_completed,
-- payment_reliability, restricted_at/restricted_by/restriction_reason,
-- and stripe_customer_id were all settable at INSERT time by the
-- account owner themselves -- e.g. inserting id = own profile id with
-- plan = 'team', reliability_score = 100, restricted_at = null. In
-- practice this is only reachable before the row already exists (id is
-- PK, so it can't be used to overwrite an existing sponsor), but that
-- window exists at every signup and the grant should never have allowed
-- it regardless.
--
-- Confirmed via grep: the only two client-side sponsors inserts
-- (supabase-client.js createProfile(), accept-invite.html) ever set
-- `id` and `company_name` only.

REVOKE INSERT ON public.sponsors FROM authenticated, anon;
GRANT INSERT (id, company_name) ON public.sponsors TO authenticated;
