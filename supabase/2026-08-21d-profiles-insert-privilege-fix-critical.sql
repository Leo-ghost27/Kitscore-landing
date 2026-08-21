-- profiles_insert_privilege_fix_CRITICAL
--
-- The UPDATE-based role-escalation hole was closed by
-- 2026-08-21c-profiles-column-privilege-fix-critical.sql, but the
-- INSERT path was left open: authenticated (and anon) held raw
-- table-level INSERT on every column including role, id, and
-- auth_user_id, and profiles_insert_own's WITH CHECK only verified
-- auth_user_id = auth.uid() -- it said nothing about role. Any
-- logged-in user could still run
--   sb.from('profiles').insert({ auth_user_id: <own uid>, role: 'admin', display_name: 'x', email: 'x' })
-- and become a platform admin. anon held the same INSERT grant, which is
-- moot only because profiles_insert_own requires auth.uid() to be
-- non-null -- revoking anyway so a future policy change doesn't quietly
-- re-open it.
--
-- Separately, handle_new_auth_user() (the SECURITY DEFINER trigger on
-- auth.users that creates the profiles row post-signup) cast
-- raw_user_meta_data->>'role' straight to user_role with no allowlist.
-- raw_user_meta_data is set via supabase.auth.signUp({ options: { data }})
-- -- fully client-controlled. Anyone could sign up with
-- { data: { role: 'admin', display_name: 'x' } } and the trigger would
-- insert an admin profiles row, completely bypassing RLS (SECURITY
-- DEFINER, runs as the function owner) and every table grant above. This
-- is arguably the more dangerous of the two vectors since it needs no
-- direct table access at all -- just the public signup form.
--
-- Confirmed via grep across app/*.html: legitimate client-side profiles
-- inserts only ever use role 'creator', 'sponsor', or 'manager' (manager
-- via the three accept-*-invite.html flows). 'admin' is never
-- client-set anywhere in the app -- there is no self-serve path to admin
-- and there must not be one.

-- 1. Column grants: same tightening pattern as the earlier UPDATE fix.
REVOKE INSERT ON public.profiles FROM authenticated, anon;
GRANT INSERT (auth_user_id, role, display_name, email) ON public.profiles TO authenticated;

-- 2. WITH CHECK: row-level defense in depth, so a future grant change
-- alone can't reopen this. Blocks 'admin' regardless of column grants.
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT
  WITH CHECK (
    auth_user_id = (SELECT auth.uid())
    AND role IN ('creator', 'sponsor', 'manager')
  );

-- 3. Close the same hole in the signup trigger -- this is SECURITY
-- DEFINER and runs as the function owner, so it bypasses RLS entirely;
-- the WITH CHECK above does not protect this path.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := new.raw_user_meta_data->>'role';
  v_display_name text := new.raw_user_meta_data->>'display_name';
  v_profile_id uuid;
begin
  -- Only act once the user's email is actually confirmed (or confirmation isn't required)
  if new.email_confirmed_at is null then
    return new;
  end if;

  -- Nothing to do if signup metadata is missing (shouldn't happen, but stay safe)
  if v_role is null or v_display_name is null then
    return new;
  end if;

  -- Signup metadata is fully client-controlled -- never trust it for
  -- anything beyond the two genuinely self-serve roles. 'manager' and
  -- 'admin' both go through their own explicit, invite/admin-gated flows
  -- elsewhere (see accept-manager-invite.html, accept-agency-staff-invite.html)
  -- and must never be reachable via signUp() metadata.
  if v_role not in ('creator', 'sponsor') then
    return new;
  end if;

  insert into public.profiles (auth_user_id, role, display_name, email)
  values (new.id, v_role::user_role, v_display_name, new.email)
  on conflict (auth_user_id) do nothing
  returning id into v_profile_id;

  -- If the row already existed (e.g. race with client-side ensureProfile), fetch its id
  if v_profile_id is null then
    select id into v_profile_id from public.profiles where auth_user_id = new.id;
  end if;

  if v_role = 'creator' then
    insert into public.creators (id) values (v_profile_id) on conflict (id) do nothing;
  elsif v_role = 'sponsor' then
    insert into public.sponsors (id, company_name) values (v_profile_id, v_display_name) on conflict (id) do nothing;
  end if;

  return new;
end;
$function$;
