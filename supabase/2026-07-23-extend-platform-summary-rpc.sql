-- Extends fn_creator_platform_summary to also return like_count and
-- subscriber_count -- needed for the new engagement-benchmark feature
-- (Tools tab shows "your rate: X% · typical range: Y%-Z%", which needs
-- the raw counts, not just the pre-computed 0-100 score value).
--
-- Still token-free: only adds two more aggregate count columns, never
-- access_token/refresh_token. Applied live via Supabase MCP on
-- 2026-07-23, documented here same-day rather than backfilled later.

DROP FUNCTION fn_creator_platform_summary(uuid);

CREATE FUNCTION public.fn_creator_platform_summary(p_creator_id uuid)
 RETURNS TABLE(platform text, platform_handle text, verification_method text, follower_count bigint, video_count bigint, view_count bigint, like_count bigint, subscriber_count bigint, last_synced_at timestamp with time zone, connected_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT platform, platform_handle, verification_method,
         follower_count, video_count, view_count, like_count, subscriber_count,
         last_synced_at, connected_at
  FROM public.platform_connections
  WHERE creator_id = p_creator_id;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_creator_platform_summary(uuid) TO authenticated;
