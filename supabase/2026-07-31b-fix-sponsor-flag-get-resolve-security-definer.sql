-- Same bug as fn_admin_list_sponsor_directory/fn_admin_flag_sponsor/
-- fn_admin_set_sponsor_restriction (see
-- 2026-07-31-fix-sponsor-admin-rpcs-security-definer.sql): sponsor_flags
-- has RLS enabled with no policies (access only via SECURITY DEFINER
-- RPCs, per the original migration's comment), but these two were never
-- marked SECURITY DEFINER either. Fixing now, before the Flags-review UI
-- that calls them ships (app/admin-sponsors.html), so it doesn't hit
-- "permission denied for table sponsor_flags" on day one. The creator-
-- side equivalents (fn_admin_get_creator_flags,
-- fn_admin_resolve_creator_flag) don't need this: admin_flags has an
-- explicit RLS policy, admin_flags_admin_all, that already permits admin
-- access as SECURITY INVOKER.
--
-- Applied directly to the live database via Supabase MCP; this file
-- documents that change for the migration history/ledger.

CREATE OR REPLACE FUNCTION public.fn_admin_get_sponsor_flags(p_profile_id uuid)
 RETURNS TABLE(id uuid, reason text, created_at timestamp with time zone, resolved boolean, flagged_by_name text, flagged_by_email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;
  return query
    select sf.id, sf.reason, sf.created_at, sf.resolved,
           p.display_name, p.email
    from sponsor_flags sf
    left join profiles p on p.id = sf.flagged_by
    where sf.sponsor_profile_id = p_profile_id
    order by sf.created_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_admin_resolve_sponsor_flag(p_flag_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;
  update sponsor_flags set resolved = true where id = p_flag_id;
end;
$function$;
