-- 2026-08-01a-admin-creator-platform-metrics.sql
--
-- platform_connections holds access_token/refresh_token and has zero RLS
-- policies (deliberately locked down -- effectively unreadable outside
-- service_role). This does NOT grant table access; it's a narrow
-- SECURITY DEFINER RPC returning only the safe synced metrics, so
-- admin-evidence.html can show "here's the OAuth-verified number on file
-- for this platform" next to a self-reported evidence upload, without
-- ever exposing a token to the browser.
CREATE OR REPLACE FUNCTION public.fn_admin_creator_platform_metrics(p_creator_id uuid)
 RETURNS TABLE(
   platform text, platform_handle text, follower_count bigint,
   subscriber_count bigint, media_count bigint, video_count bigint,
   view_count bigint, avg_likes_per_post numeric, avg_comments_per_post numeric,
   last_synced_at timestamptz
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;

  return query
    select pc.platform, pc.platform_handle, pc.follower_count, pc.subscriber_count,
           pc.media_count, pc.video_count, pc.view_count, pc.avg_likes_per_post,
           pc.avg_comments_per_post, pc.last_synced_at
    from public.platform_connections pc
    where pc.creator_id = p_creator_id;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_admin_creator_platform_metrics(uuid) TO authenticated;
