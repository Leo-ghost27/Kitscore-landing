-- 2026-07-07-document-signup-notification-trigger.sql
--
-- This trigger + function already existed live on tpcriphrfrrgywycviqv with
-- zero trace in the repo -- found while investigating whether Gina still
-- receives new-signup alerts. It's a pure database-level notification path
-- (fires on `profiles` insert, calls Resend directly via pg_net), entirely
-- separate from the app's Node.js email code in lib/email.js, which is why
-- a repo-only search wouldn't find it. Documented here, not modified --
-- confirmed working via pg_net's own response log (last real creator
-- signup, July 6 06:57 UTC, delivered successfully, HTTP 200).
--
-- Recipient is gina.hamza@kitscore.co, sender is hello@kitscore.co.

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

    perform net.http_post(
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

  exception when others then
    insert into public.notification_failures (kind, recipient_email, error, attempts, created_at, last_attempted_at)
    values ('admin_signup_alert', v_admin_email, sqlerrm, 1, now(), now());
  end;

  return new;
end;
$function$;

-- Note for future debugging: because net.http_post is asynchronous, the
-- exception handler above only catches SYNCHRONOUS failures (e.g. the
-- Vault secret missing entirely) -- it can't see a Resend API error that
-- happens after the trigger has already returned. To check actual delivery
-- outcomes, query net._http_response directly rather than trusting an
-- empty notification_failures table as proof everything is fine:
--   select * from net._http_response order by created desc limit 20;

CREATE TRIGGER trg_notify_admin_on_signup
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION fn_notify_admin_on_signup();
