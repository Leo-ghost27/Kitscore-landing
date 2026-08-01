-- 2026-07-31e-verify-before-resolve-profile-creation.sql
--
-- fn_admin_resolve_client_failure previously just set resolved_at with no
-- check -- clicking the button meant "an admin looked at this," not "this
-- is actually fixed." For kind = 'profile_creation' specifically, we can
-- do better: the context jsonb captured at log time (see
-- logProfileCreationFailure in app/supabase-client.js) includes
-- auth_user_id, so we can check whether a profiles row now actually
-- exists for that user before allowing the resolve. Other kinds (and
-- notification_failure) have no equivalent checkable signal yet, so they
-- stay trust-based -- that's a real, named limitation, not silently
-- pretended away.
CREATE OR REPLACE FUNCTION public.fn_admin_resolve_client_failure(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
declare
  v_row record;
  v_target_user uuid;
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;

  select * into v_row from public.client_failures where id = p_id;
  if v_row is null then
    raise exception 'NOT_FOUND: no client_failure with that id';
  end if;

  if v_row.kind = 'profile_creation' then
    v_target_user := nullif(v_row.context->>'auth_user_id', '')::uuid;
    if v_target_user is not null
       and not exists (select 1 from public.profiles where auth_user_id = v_target_user) then
      raise exception 'STILL_UNRESOLVED: no profile row exists yet for this user -- fix that first, then resolve';
    end if;
  end if;

  update public.client_failures set resolved_at = now() where id = p_id;
end;
$function$;
