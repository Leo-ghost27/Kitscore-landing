-- 2026-08-11c-SECURITY-fix-unauthenticated-score-tampering.sql
--
-- Two real, live vulnerabilities found while sweeping every SECURITY
-- DEFINER function for the missing-auth-check pattern already found
-- twice this week (fn_validate_creator_rating's NULL-comparison bypass,
-- the sponsor-reliability trigger watching a dead column). Both fixed
-- immediately in Supabase before this file was written; this documents
-- them.
--
-- 1. fn_admin_disconnect_platform(creator_id, platform) -- SECURITY
--    DEFINER, EXECUTE granted to `anon` (no login required). Unlike
--    every other fn_admin_* function, it had no fn_is_admin() check at
--    all. Any unauthenticated caller could delete any creator's
--    platform connection and score components and trigger a rebalance
--    -- full unauthenticated sabotage of a creator's trust score, no
--    account needed. Fixed: added the same admin check every sibling
--    function already has, and revoked anon/PUBLIC execute as
--    belt-and-braces (authenticated keeps it; fn_is_admin() is the real
--    gate, matching the grant pattern on every other admin function).
--
-- 2. fn_rebalance_component_family(creator_id, prefix, total_weight) --
--    a plain callable function (not a trigger), no auth check, directly
--    UPDATEs an arbitrary creator's score_components weights. Confirmed
--    via grep that no client code calls this RPC directly -- it's an
--    internal helper only ever invoked from within fn_disconnect_platform
--    and fn_admin_disconnect_platform, after *their* checks already
--    passed. Fixed by revoking anon/authenticated/PUBLIC execute
--    entirely rather than adding a check: this was never meant to be
--    its own endpoint, so the fix is removing callability, not gating
--    it. Internal calls are unaffected -- both callers are themselves
--    SECURITY DEFINER and execute as the function owner (postgres),
--    which keeps EXECUTE.
--
-- Broader sweep also checked all other SECURITY DEFINER functions with
-- no fn_is_admin/fn_current_profile_id/auth.uid() marker in their body:
-- the rest are either legitimately public (badge pages, invite tokens,
-- pricing benchmark, endorsements) or trigger functions, which are not
-- directly callable via RPC regardless of grants (Postgres rejects a
-- direct call to a trigger function outside trigger context) --
-- confirmed for fn_capture_follower_history, fn_capture_trust_score_
-- history, and fn_set_evidence_reviewed_at specifically, since those
-- three matched the same "anon-granted, no auth marker" heuristic that
-- flagged the two real bugs above.

CREATE OR REPLACE FUNCTION public.fn_admin_disconnect_platform(p_creator_id uuid, p_platform text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;

  delete from platform_connections
  where creator_id = p_creator_id and platform = p_platform;

  delete from score_components
  where creator_id = p_creator_id
    and component_key in (
      'engagement_quality_' || p_platform,
      'content_consistency_' || p_platform
    );

  perform fn_rebalance_component_family(p_creator_id, 'engagement_quality', 0.20);
  perform fn_rebalance_component_family(p_creator_id, 'content_consistency', 0.20);
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_admin_disconnect_platform(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_admin_disconnect_platform(uuid, text) FROM PUBLIC;

-- fn_rebalance_component_family's own body was live but never committed
-- either -- backfilling it here since this is where its grants changed.
CREATE OR REPLACE FUNCTION public.fn_rebalance_component_family(p_creator_id uuid, p_prefix text, p_total_weight numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  select count(*) into v_count
  from score_components
  where creator_id = p_creator_id
    and component_key like p_prefix || '\_%' escape '\';

  if v_count = 0 then
    return;
  end if;

  update score_components
  set weight = round(p_total_weight / v_count, 4), updated_at = now()
  where creator_id = p_creator_id
    and component_key like p_prefix || '\_%' escape '\';
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_rebalance_component_family(uuid, text, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_rebalance_component_family(uuid, text, numeric) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_rebalance_component_family(uuid, text, numeric) FROM PUBLIC;
