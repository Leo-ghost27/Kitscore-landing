-- CRITICAL. Found doing a full sweep after the managers/sponsors/creators
-- fixes. This is the master key to the entire system: profiles.role is
-- what fn_current_role()/fn_is_admin() read to gate literally every other
-- admin check across every table. profiles_update_own RLS had no
-- WITH CHECK at all (just USING: auth_user_id = auth.uid() OR admin), and
-- authenticated held raw table-level UPDATE on every column including
-- role, auth_user_id, and email. Any logged-in user could run
--   sb.from('profiles').update({ role: 'admin' }).eq('id', profile.id)
-- and become a platform admin -- full access to every fn_is_admin() gated
-- table and RPC in the system, immediately, with one call. Also:
-- auth_user_id being writable meant a user could point their OWN profile
-- row at a DIFFERENT auth account (or vice versa), which is a distinct
-- account-hijack vector on top of the admin escalation.
--
-- Confirmed via grep across app/*.html before fixing: the only column any
-- client code ever writes on profiles is display_name (three separate
-- profile-edit pages). email is never client-written (Supabase Auth's own
-- email-change flow handles that, separately from this table).
--
-- Note: this fixed UPDATE only. The parallel INSERT vector (same
-- role-escalation risk, plus a second path through the signup trigger)
-- was still open after this and is closed separately in
-- 2026-08-21d-profiles-insert-privilege-fix-critical.sql.

REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (display_name, created_at) ON public.profiles TO authenticated;

-- Add the WITH CHECK that was missing entirely, as defense-in-depth on
-- top of the column-grant fix (belt and suspenders: even if a future
-- grant change re-opens a column, the row-level check still holds).
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE
  USING ((auth_user_id = (SELECT auth.uid())) OR fn_is_admin())
  WITH CHECK ((auth_user_id = (SELECT auth.uid())) OR fn_is_admin());
