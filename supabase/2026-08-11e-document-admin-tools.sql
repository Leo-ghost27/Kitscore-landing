-- 2026-08-11e, same drift-audit batch. Seven admin-panel functions, all
-- confirmed to have the fn_is_admin() guard already (checked across all
-- 21 fn_admin_* functions specifically, since that's the exact class the
-- fn_admin_disconnect_platform bug came from -- see 2026-08-11c). Also
-- backfills the trg_sponsor_reliability_on_creator_rating trigger
-- ATTACHMENT statement itself: 2026-08-10c already committed a
-- CREATE OR REPLACE on its function body, but the original CREATE
-- TRIGGER wiring it to campaigns was itself never committed anywhere --
-- one more instance of the pattern this whole audit is closing.
-- No logic changes, pure backfill.

CREATE OR REPLACE FUNCTION public.fn_admin_clear_stale_oauth(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;
  delete from public.oauth_states where id = p_id and created_at < now() - interval '1 hour';
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_admin_get_creator_flags(p_profile_id uuid)
RETURNS TABLE(id uuid, reason text, created_at timestamp with time zone, resolved boolean, flagged_by_name text, flagged_by_email text)
LANGUAGE plpgsql
AS $function$
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;
  return query
    select af.id, af.reason, af.created_at, af.resolved,
           p.display_name, p.email
    from admin_flags af
    left join profiles p on p.id = af.flagged_by
    where af.creator_profile_id = p_profile_id
    order by af.created_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_admin_list_contracts()
RETURNS TABLE(id uuid, title text, status text, sponsor_name text, sponsor_email text, creator_name text, creator_email text, compensation text, deliverables text, created_at timestamp with time zone, updated_at timestamp with time zone, sponsor_signed_at timestamp with time zone, creator_signed_at timestamp with time zone, days_since_activity integer, is_stuck boolean, is_voided boolean, is_test boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;

  return query
  select
    c.id, c.title, c.status::text,
    sp.display_name, sp.email,
    cp.display_name, cp.email,
    c.compensation, c.deliverables,
    c.created_at, c.updated_at,
    c.sponsor_signed_at, c.creator_signed_at,
    extract(day from now() - c.updated_at)::integer,
    c.status in ('sent','signed_by_creator','signed_by_sponsor')
      and c.updated_at < now() - interval '7 days',
    c.status = 'void',
    coalesce(s.is_test, false) or coalesce(cr.is_test, false)
  from contracts c
  join profiles sp on sp.id = c.sponsor_id
  join profiles cp on cp.id = c.creator_id
  left join sponsors s on s.id = c.sponsor_id
  left join creators cr on cr.id = c.creator_id
  order by
    (c.status in ('sent','signed_by_creator','signed_by_sponsor') and c.updated_at < now() - interval '7 days') desc,
    c.updated_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_admin_list_health_issues()
RETURNS TABLE(id uuid, category text, kind text, detail text, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;

  return query
    select cf.id, 'client_failure'::text, cf.kind, cf.detail, cf.created_at
    from public.client_failures cf
    where cf.resolved_at is null
      and cf.created_at > now() - interval '7 days'

    union all

    select nf.id, 'notification_failure'::text, nf.kind, nf.error, nf.created_at
    from public.notification_failures nf
    where nf.resolved_at is null
      and nf.created_at > now() - interval '7 days'

    union all

    select os.id, 'stale_oauth_connection'::text, os.platform, null::text, os.created_at
    from public.oauth_states os
    where os.created_at < now() - interval '1 hour'

    order by created_at asc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_admin_resolve_creator_flag(p_flag_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;
  update admin_flags set resolved = true where id = p_flag_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_admin_resolve_notification_failure(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;
  update public.notification_failures set resolved_at = now() where id = p_id;
end;
$function$;

-- fn_admin_disconnect_platform intentionally NOT redefined here -- see
-- 2026-08-11c for the fixed version (this file predates that fix in
-- read order within the same batch; committing the pre-fix body here
-- would silently undo it on a fresh replay).

DROP TRIGGER IF EXISTS trg_sponsor_reliability_on_creator_rating ON public.campaigns;
CREATE TRIGGER trg_sponsor_reliability_on_creator_rating
  AFTER UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION trg_sponsor_reliability_on_creator_rating();
