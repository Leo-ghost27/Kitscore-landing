-- 2026-07-07-notification-delivery-failure-detection.sql
--
-- Closes the real gap found while checking notification_failures (open
-- since v26): that table only ever caught SYNCHRONOUS errors inside the
-- signup trigger (e.g. a missing Vault secret) via its exception handler.
-- net.http_post() is fire-and-forget -- the actual Resend response (200,
-- 401, 422, timeout, whatever) lands later in net._http_response, which
-- nothing was watching. Confirmed by inspection: notification_failures
-- has zero rows ever, and net._http_response has exactly one row ever
-- (the July 6 signup, HTTP 200) -- so there's no evidence of a real
-- failure today, but there was also no way today's setup would have
-- caught one if it happened. This migration closes that blind spot.
--
-- Mechanism: capture the bigint request id net.http_post() returns (it
-- was being discarded via `perform` before), store it alongside what the
-- call was for in a small correlation table, then react when pg_net
-- writes the matching response row.

-- =============================================================
-- 1. notification_requests -- transient correlation table. A row exists
--    only between "we sent the request" and "we got the response back
--    and processed it" -- cleaned up either way, so this stays small.
-- =============================================================
CREATE TABLE public.notification_requests (
  net_request_id bigint PRIMARY KEY,
  kind text NOT NULL,
  recipient_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_requests ENABLE ROW LEVEL SECURITY;

-- Same shape as notification_failures: admin-only read, no client insert/
-- update policy at all -- the only writer is the SECURITY DEFINER trigger
-- function below, which runs as the table owner and bypasses RLS. Broad
-- grants to anon/authenticated to match this schema's established
-- convention (RLS is the real gate, not the grant), same as every other
-- table here.
CREATE POLICY notification_requests_admin_select ON public.notification_requests FOR SELECT
  USING (fn_is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_requests TO anon, authenticated;

-- =============================================================
-- 2. fn_notify_admin_on_signup -- same function as before, with one
--    change: capture net.http_post()'s return value (the request id)
--    instead of discarding it via `perform`, and record what that
--    request was for.
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_notify_admin_on_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_api_key text;
  v_admin_email text := 'gina.hamza@kitscore.co';
  v_subject text;
  v_body text;
  v_request_id bigint;
begin
  if new.role not in ('creator','sponsor') then
    return new;
  end if;

  begin
    select decrypted_secret into v_api_key
    from vault.decrypted_secrets
    where name = 'resend_api_key'
    limit 1;

    if v_api_key is null then
      raise exception 'resend_api_key not found in Vault';
    end if;

    v_subject := initcap(new.role::text) || ' signup: ' || coalesce(new.display_name, new.email);
    v_body := 'New ' || new.role || ' signed up on Kitscore.<br><br>' ||
              'Name: ' || coalesce(new.display_name, '(none)') || '<br>' ||
              'Email: ' || coalesce(new.email, '(none)') || '<br>' ||
              'Signed up: ' || new.created_at;

    v_request_id := net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_api_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'from', 'Kitscore <hello@kitscore.co>',
        'to', jsonb_build_array(v_admin_email),
        'subject', v_subject,
        'html', v_body
      )
    );

    insert into public.notification_requests (net_request_id, kind, recipient_email)
    values (v_request_id, 'admin_signup_alert', v_admin_email);

  exception when others then
    insert into public.notification_failures (kind, recipient_email, error, attempts, created_at, last_attempted_at)
    values ('admin_signup_alert', v_admin_email, sqlerrm, 1, now(), now());
  end;

  return new;
end;
$function$;

-- =============================================================
-- 3. fn_flag_failed_notification -- reacts when pg_net writes a
--    response row. Looks up whether it's one we're tracking; if the
--    response is anything other than a clean 2xx, logs it into
--    notification_failures the same way the sync-error path already
--    does, so both failure modes land in the one place someone would
--    actually go look.
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_flag_failed_notification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
declare
  v_req record;
begin
  select * into v_req from public.notification_requests where net_request_id = new.id;
  if v_req.net_request_id is null then
    return new; -- not a request we're tracking (e.g. some other pg_net caller)
  end if;

  if new.timed_out is true or new.status_code is null or new.status_code < 200 or new.status_code >= 300 then
    insert into public.notification_failures (kind, recipient_email, error, attempts, created_at, last_attempted_at)
    values (
      v_req.kind,
      v_req.recipient_email,
      coalesce(new.error_msg, 'HTTP ' || coalesce(new.status_code::text, 'no response')) || (case when new.timed_out then ' (timed out)' else '' end),
      1, now(), now()
    );
  end if;

  delete from public.notification_requests where net_request_id = new.id;
  return new;
end;
$$;

CREATE TRIGGER trg_flag_failed_notification
  AFTER INSERT ON net._http_response
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_flag_failed_notification();
