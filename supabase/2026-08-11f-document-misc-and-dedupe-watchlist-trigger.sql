-- 2026-08-11f, last file in the drift-audit batch. Four small
-- creator-facing functions (spot-checked, no bugs), plus a real (if
-- low-severity) cleanup: fn_enforce_watchlist_cap and fn_enforce_
-- watchlist_limit are two independently-built triggers on watchlists,
-- both enforcing the identical free-plan cap of 3, both firing on every
-- insert. Harmless today (same outcome), but a latent trap -- fix the
-- cap logic in one later and the other silently keeps enforcing the old
-- rule. Keeping fn_enforce_watchlist_limit as canonical: it uses the
-- proper plan_tier enum comparison instead of a string/null check, and
-- generalizes past a hardcoded 'free' cap of 3 to any plan with a
-- defined max. Dropping fn_enforce_watchlist_cap and its trigger.

CREATE OR REPLACE FUNCTION public.fn_get_badge_data(p_slug text)
RETURNS TABLE(display_name text, trust_score numeric, badge_tier text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.display_name, c.trust_score, c.badge_tier
  FROM creators c
  JOIN profiles p ON p.id = c.id
  WHERE c.slug = p_slug AND c.is_test = false;
$function$;

CREATE OR REPLACE FUNCTION public.fn_my_sponsor_plan()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select plan::text from sponsors where id = fn_current_profile_id();
$function$;

CREATE OR REPLACE FUNCTION public.fn_disconnect_platform(p_platform text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_creator_id uuid;
begin
  select id into v_creator_id from profiles where auth_user_id = auth.uid();
  if v_creator_id is null then
    raise exception 'Not authenticated as a creator';
  end if;

  delete from platform_connections
  where creator_id = v_creator_id and platform = p_platform;

  delete from score_components
  where creator_id = v_creator_id
    and component_key in (
      'engagement_quality_' || p_platform,
      'content_consistency_' || p_platform
    );

  perform fn_rebalance_component_family(v_creator_id, 'engagement_quality', 0.20);
  perform fn_rebalance_component_family(v_creator_id, 'content_consistency', 0.20);
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_touch_support_ticket()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolved_at := now();
  elsif new.status <> 'resolved' then
    new.resolved_at := null;
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_support_tickets_touch ON public.support_tickets;
CREATE TRIGGER trg_support_tickets_touch
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION fn_touch_support_ticket();

CREATE OR REPLACE FUNCTION public.fn_enforce_watchlist_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  sponsor_plan plan_tier;
  current_count int;
  max_allowed int;
begin
  select plan into sponsor_plan from sponsors where id = new.sponsor_id;
  max_allowed := case when sponsor_plan = 'free' then 3 else null end;

  if max_allowed is not null then
    select count(*) into current_count from watchlists where sponsor_id = new.sponsor_id;
    if current_count >= max_allowed then
      raise exception 'Free plan is limited to % saved creators. Upgrade to save more.', max_allowed;
    end if;
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_watchlist_limit ON public.watchlists;
CREATE TRIGGER trg_enforce_watchlist_limit
  BEFORE INSERT ON public.watchlists
  FOR EACH ROW EXECUTE FUNCTION fn_enforce_watchlist_limit();

-- Real cleanup: drop the duplicate trigger + function.
DROP TRIGGER IF EXISTS trg_enforce_watchlist_cap ON public.watchlists;
DROP FUNCTION IF EXISTS public.fn_enforce_watchlist_cap();

DROP TRIGGER IF EXISTS trg_capture_watchlist_trust_score ON public.watchlists;
CREATE OR REPLACE FUNCTION public.fn_capture_watchlist_trust_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if new.trust_score_at_save is null then
    select trust_score into new.trust_score_at_save from creators where id = new.creator_id;
  end if;
  return new;
end;
$function$;
CREATE TRIGGER trg_capture_watchlist_trust_score
  BEFORE INSERT ON public.watchlists
  FOR EACH ROW EXECUTE FUNCTION fn_capture_watchlist_trust_score();
