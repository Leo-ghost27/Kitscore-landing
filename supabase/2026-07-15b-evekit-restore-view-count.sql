-- 2026-07-15-evekit-theme-customization.sql (a parallel session, same day)
-- recreated fn_get_evekit_profile to add the `theme` column, but was built
-- from a spec/snapshot that predated 2026-07-14b-evekit-platform-view-count.sql
-- -- so it silently dropped view_count back out of the platforms jsonb.
-- Caught during a full repo/process review on 2026-07-15. This is exactly
-- the kind of silent-drift risk supabase/README.md was written to prevent:
-- two sessions independently DROP+CREATE-ing the same function from their
-- own local understanding of it, with no lock or diff between them.
--
-- This migration is the union of both: theme (from the parallel session)
-- + view_count (from earlier the same day). No functional change beyond
-- restoring view_count -- if you're reading this after a future function
-- change and it's already unified, this file is safe to leave as a no-op
-- record, not something that needs re-running.

DROP FUNCTION IF EXISTS public.fn_get_evekit_profile(text);

CREATE FUNCTION public.fn_get_evekit_profile(p_slug text)
RETURNS TABLE(
  display_name text, niche text, location text, bio text, business_email text,
  avatar_url text, gallery_images jsonb, available_for text[], causes text[], theme text,
  trust_score numeric, confidence numeric, badge_tier text, founding_cohort boolean,
  reliability_score numeric, verified_campaign_count bigint, profile_views integer,
  audience_countries jsonb, audience_genders jsonb, audience_ages jsonb,
  platforms jsonb, campaigns jsonb, collaborations jsonb, press_mentions jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.display_name, c.niche, c.location, c.bio, c.business_email,
    c.avatar_url, c.gallery_images, c.available_for, c.causes, c.theme,
    c.trust_score, c.confidence::numeric, c.badge_tier, c.founding_cohort,
    c.reliability_score,
    (SELECT count(*) FROM campaigns cam WHERE cam.creator_id = c.id AND cam.creator_confirmed AND cam.sponsor_confirmed),
    c.profile_views,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('label', ad.label, 'pct', ad.pct) ORDER BY ad.pct DESC)
       FROM audience_demographics ad WHERE ad.creator_id = c.id AND ad.dimension = 'country'),
      '[]'::jsonb
    ),
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('label', ad.label, 'pct', ad.pct) ORDER BY ad.pct DESC)
       FROM audience_demographics ad WHERE ad.creator_id = c.id AND ad.dimension = 'gender'),
      '[]'::jsonb
    ),
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('label', ad.label, 'pct', ad.pct) ORDER BY ad.pct DESC)
       FROM audience_demographics ad WHERE ad.creator_id = c.id AND ad.dimension = 'age'),
      '[]'::jsonb
    ),
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
         'platform', pc.platform, 'platform_handle', pc.platform_handle,
         'follower_count', pc.follower_count, 'video_count', pc.video_count,
         'view_count', pc.view_count, 'verification_method', pc.verification_method
       ) ORDER BY pc.follower_count DESC NULLS LAST)
       FROM platform_connections pc WHERE pc.creator_id = c.id AND pc.follower_count IS NOT NULL),
      '[]'::jsonb
    ),
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
         'name', cam.name, 'objective', cam.objective, 'completed_at', cam.completed_at
       ) ORDER BY cam.created_at DESC)
       FROM (
         SELECT * FROM campaigns cam2
         WHERE cam2.creator_id = c.id AND cam2.creator_confirmed AND cam2.sponsor_confirmed
         ORDER BY cam2.created_at DESC
         LIMIT 6
       ) cam),
      '[]'::jsonb
    ),
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
         'brand_name', cc.brand_name, 'logo_url', cc.logo_url, 'link', cc.link
       ) ORDER BY cc.display_order, cc.created_at)
       FROM creator_collaborations cc WHERE cc.creator_id = c.id),
      '[]'::jsonb
    ),
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
         'id', cpm.id, 'title', cpm.title, 'outlet_name', cpm.outlet_name,
         'url', cpm.url, 'mention_date', cpm.mention_date
       ) ORDER BY cpm.display_order, cpm.created_at)
       FROM creator_press_mentions cpm WHERE cpm.creator_id = c.id),
      '[]'::jsonb
    )
  FROM creators c
  JOIN profiles p ON p.id = c.id
  WHERE c.slug = p_slug AND c.is_test = false;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_get_evekit_profile(text) TO anon, authenticated;
