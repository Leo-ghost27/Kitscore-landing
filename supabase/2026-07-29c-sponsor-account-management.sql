-- Sponsor account management for admins. Creators already had a full
-- Directory with flag-for-review (admin-directory.html, admin_flags,
-- fn_admin_flag_creator); sponsors had zero equivalent -- no way to
-- review, flag, or restrict a problematic sponsor account.
--
-- admin_flags is hardcoded to creator_profile_id (NOT NULL) and already
-- in active use by both the manual creator-flag flow and the automatic
-- audience-authenticity fraud check -- not repurposed. sponsor_flags is
-- a genuinely parallel table, same shape.
--
-- Also adds real account restriction, not just flagging: a restricted
-- sponsor is blocked (via RLS, see
-- 2026-07-29-enforce-sponsor-restriction-on-briefs.sql, and a direct
-- check in api/generate-evaluation.js) from posting new briefs or
-- requesting new evaluations. Existing/historical data stays visible --
-- nothing is deleted, and this intentionally does not touch escrow
-- (that's the other session's "escrow oversight" work).

CREATE TABLE public.sponsor_flags (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sponsor_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  flagged_by uuid REFERENCES public.profiles(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_sponsor_flags_sponsor ON public.sponsor_flags(sponsor_profile_id);
ALTER TABLE public.sponsor_flags ENABLE ROW LEVEL SECURITY;
-- Same access pattern as admin_flags: no direct client policies, access
-- only via SECURITY DEFINER RPCs below.

ALTER TABLE public.sponsors ADD COLUMN restricted_at timestamptz;
ALTER TABLE public.sponsors ADD COLUMN restricted_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.sponsors ADD COLUMN restriction_reason text;

CREATE OR REPLACE FUNCTION public.fn_admin_list_sponsor_directory()
 RETURNS TABLE(profile_id uuid, display_name text, email text, created_at timestamp with time zone,
   company_name text, plan text, subscription_status text, campaigns_completed integer,
   reliability_score numeric, is_flagged boolean, is_restricted boolean, restriction_reason text)
 LANGUAGE plpgsql
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

GRANT EXECUTE ON FUNCTION public.fn_admin_list_sponsor_directory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_flag_sponsor(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_set_sponsor_restriction(uuid, boolean, text) TO authenticated;
