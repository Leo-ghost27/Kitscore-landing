-- 2026-07-31c-client-failure-log-and-health-summary.sql
--
-- Closes a real blind spot: profile-creation failures (the auth.html /
-- accept-invite.html gap fixed alongside this migration -- see
-- app/supabase-client.js createProfile/ensureProfile) and abandoned/failed
-- OAuth platform connections were both only ever visible by accident, via
-- manual testing or a specific person's bug report. Nothing aggregated
-- them anywhere an admin would actually look.
--
-- Two pieces:
--   1. client_failures -- generic table for browser-side failures the
--      client itself can detect but can't retry (mirrors the existing
--      notification_failures pattern for server-side email failures).
--      Written via fn_log_client_failure, a SECURITY DEFINER RPC so no
--      INSERT policy is needed on the table itself -- same shape as
--      fn_notify_admin_on_signup's relationship to notification_failures.
--   2. fn_admin_health_summary -- one RPC the admin UI can call to see
--      client_failures + notification_failures + stale (abandoned/failed)
--      oauth_states in one place. oauth_states rows are deleted on a
--      successful OAuth callback (see e.g. discord-oauth-callback.js) --
--      a row still present well past a normal callback round-trip means
--      that connection attempt never completed, without needing to touch
--      any of the five OAuth handler files to detect it.

-- =============================================================
-- 1. client_failures
-- =============================================================
CREATE TABLE public.client_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  detail text,
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

ALTER TABLE public.client_failures ENABLE ROW LEVEL SECURITY;

-- Admin-only read, same convention as notification_failures_admin_select.
-- No client insert/update/delete policy at all -- the only writer is the
-- SECURITY DEFINER function below.
CREATE POLICY client_failures_admin_select ON public.client_failures FOR SELECT
  USING (fn_is_admin());

GRANT SELECT ON public.client_failures TO anon, authenticated;

-- =============================================================
-- 2. fn_log_client_failure -- callable by any authenticated user to
--    report a failure about their own session (e.g. ensureProfile()
--    couldn't create a profile row). Deliberately does not require or
--    check p_context beyond size -- it's the client's own auth_user_id/
--    email it's reporting, same visibility that user already has into
--    their own session.
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_log_client_failure(p_kind text, p_detail text, p_context jsonb DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
begin
  insert into public.client_failures (kind, detail, context)
  values (p_kind, left(coalesce(p_detail, ''), 2000), p_context);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_log_client_failure(text, text, jsonb) TO authenticated;

-- =============================================================
-- 3. fn_admin_health_summary -- one place for the admin UI to see
--    unresolved client_failures, unresolved notification_failures, and
--    stale oauth_states, all as one shape. Same admin-gate pattern as
--    fn_admin_list_sponsor_directory (raise exception if not admin,
--    rather than relying on a table-level policy the function would
--    otherwise bypass as SECURITY DEFINER).
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_admin_health_summary()
 RETURNS TABLE(category text, kind text, count bigint, oldest timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;

  return query
    select 'client_failure'::text, cf.kind, count(*), min(cf.created_at)
    from public.client_failures cf
    where cf.resolved_at is null
      and cf.created_at > now() - interval '7 days'
    group by cf.kind

    union all

    select 'notification_failure'::text, nf.kind, count(*), min(nf.created_at)
    from public.notification_failures nf
    where nf.resolved_at is null
      and nf.created_at > now() - interval '7 days'
    group by nf.kind

    union all

    -- A row older than 1 hour means that OAuth flow never got a callback
    -- (denied, errored, or the tab was just closed) -- normal round-trips
    -- take seconds, not an hour.
    select 'stale_oauth_connection'::text, os.platform, count(*), min(os.created_at)
    from public.oauth_states os
    where os.created_at < now() - interval '1 hour'
    group by os.platform;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_admin_health_summary() TO authenticated;
