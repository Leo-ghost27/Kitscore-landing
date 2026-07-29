-- Fix #5 from the marketing/competitive review: KitScore could easily
-- see creator signup counts (admin-signups.html) but had no visibility
-- into the thing that actually makes a trust score valuable -- whether
-- real sponsors are active on the other side. A creator with an 80
-- trust score and zero sponsors ever looking at it is a churn risk
-- headcount alone won't show.
--
-- Internal/admin only, per user decision -- not shown to creators
-- (a low number would do more harm than good before there's real
-- volume to show).
--
-- Deliberately activity-based, not just "role = sponsor" headcount:
-- a sponsor account that signed up and never logged or confirmed a
-- campaign isn't liquidity, it's a ghost account.
CREATE OR REPLACE FUNCTION public.fn_admin_sponsor_liquidity()
 RETURNS TABLE(
   total_sponsors bigint,
   sponsors_with_any_campaign bigint,
   sponsors_with_confirmed_campaign bigint,
   sponsors_active_last_30d bigint,
   ghost_sponsors bigint
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;

  return query
  SELECT
    (SELECT count(*) FROM profiles WHERE role = 'sponsor'),
    (SELECT count(DISTINCT sponsor_id) FROM campaigns WHERE sponsor_id IS NOT NULL),
    (SELECT count(DISTINCT sponsor_id) FROM campaigns WHERE sponsor_id IS NOT NULL AND creator_confirmed AND sponsor_confirmed),
    (SELECT count(DISTINCT sponsor_id) FROM campaigns WHERE sponsor_id IS NOT NULL AND created_at > now() - interval '30 days'),
    (SELECT count(*) FROM profiles p WHERE p.role = 'sponsor'
       AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.sponsor_id = p.id));
end;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_admin_sponsor_liquidity() TO authenticated;
