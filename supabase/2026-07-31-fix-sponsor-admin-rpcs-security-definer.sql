-- The 2026-07-29c sponsor-account-management migration created
-- sponsor_flags with RLS enabled and NO policies, intending access only
-- via SECURITY DEFINER RPCs (per that migration's own comment) -- but
-- never actually added SECURITY DEFINER to the three functions. Running
-- as SECURITY INVOKER, they executed with the calling (authenticated)
-- role's own permissions, which have no grant on sponsor_flags at all,
-- producing "permission denied for table sponsor_flags" on the admin
-- Sponsors page. admin_flags' equivalent works today only because it has
-- an explicit RLS policy (admin_flags_admin_all); sponsor_flags has none
-- by design, so SECURITY DEFINER is the only way these were ever going
-- to work. search_path is pinned to public for SECURITY DEFINER safety
-- (prevents a malicious search_path from shadowing fn_is_admin/profiles/
-- sponsors/sponsor_flags with attacker-controlled objects).
--
-- Applied directly to the live database via Supabase MCP; this file
-- documents that change for the migration history/ledger.

CREATE OR REPLACE FUNCTION public.fn_admin_list_sponsor_directory()
 RETURNS TABLE(profile_id uuid, display_name text, email text, created_at timestamp with time zone,
   company_name text, plan text, subscription_status text, campaigns_completed integer,
   reliability_score numeric, is_flagged boolean, is_restricted boolean, restriction_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;
  return query
    select
      p.id, p.display_name, p.email, p.created_at,
      s.company_name, s.plan::text, s.subscription_status, s.campaigns_completed, s.reliability_score,
      exists(select 1 from sponsor_flags sf where sf.sponsor_profile_id = p.id and sf.resolved = false),
      s.restricted_at is not null,
      s.restriction_reason
    from profiles p
    join sponsors s on s.id = p.id
    where p.role = 'sponsor'
    order by p.created_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_admin_flag_sponsor(p_profile_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
declare
  v_admin_id uuid;
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;
  select id into v_admin_id from profiles where auth_user_id = auth.uid();
  insert into sponsor_flags (sponsor_profile_id, flagged_by, reason)
  values (p_profile_id, v_admin_id, p_reason);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_admin_set_sponsor_restriction(p_profile_id uuid, p_restricted boolean, p_reason text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
declare
  v_admin_id uuid;
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;
  select id into v_admin_id from profiles where auth_user_id = auth.uid();
  if p_restricted then
    update sponsors set restricted_at = now(), restricted_by = v_admin_id, restriction_reason = p_reason where id = p_profile_id;
  else
    update sponsors set restricted_at = null, restricted_by = null, restriction_reason = null where id = p_profile_id;
  end if;
end;
$function$;
