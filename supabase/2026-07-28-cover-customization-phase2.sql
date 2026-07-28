-- Cover customization, phase 2 (see: creator-requested "give them a way
-- to customize it themselves" -- the raw cover_image_url column added
-- 2026-07-21 was never finished/wired up; this replaces that direction
-- with a bounded, template-driven approach instead of an open photo
-- upload, since a curated preset system is what actually reads as
-- "designed" rather than "uploaded", and keeps every kit visually
-- cohesive with the rest of the KitScore brand.
--
-- Deliberately NOT free-text tags or an open color picker -- bounded
-- choices (fixed pattern set, fixed tag vocabulary, existing theme
-- system for color) keep this fast to pick and impossible to make ugly,
-- the same tradeoff Canva templates make.
--
-- All four columns are written directly from the client via
-- creators_update_own RLS (same pattern as the existing `theme` column
-- and setEkTheme/selectEkTheme in evekit.html) -- no new API route
-- needed, so this doesn't touch the Vercel function count.

ALTER TABLE public.creators
  ADD COLUMN IF NOT EXISTS cover_pattern text NOT NULL DEFAULT 'none';

ALTER TABLE public.creators
  DROP CONSTRAINT IF EXISTS creators_cover_pattern_check;
ALTER TABLE public.creators
  ADD CONSTRAINT creators_cover_pattern_check
  CHECK (cover_pattern IN ('none','dots','lines','waves'));

ALTER TABLE public.creators
  ADD COLUMN IF NOT EXISTS cover_tags text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.creators
  DROP CONSTRAINT IF EXISTS creators_cover_tags_check;
ALTER TABLE public.creators
  ADD CONSTRAINT creators_cover_tags_check
  CHECK (
    cardinality(cover_tags) <= 3
    AND cover_tags <@ ARRAY[
      'cozycore','lifestyle','outdoorsy','comedy','beauty','fitness',
      'gaming','food','travel','tech','music','fashion','parenting',
      'wellness','diy'
    ]::text[]
  );

ALTER TABLE public.creators
  ADD COLUMN IF NOT EXISTS cover_spotlight_stat text;

ALTER TABLE public.creators
  DROP CONSTRAINT IF EXISTS creators_cover_spotlight_stat_check;
ALTER TABLE public.creators
  ADD CONSTRAINT creators_cover_spotlight_stat_check
  CHECK (cover_spotlight_stat IS NULL OR cover_spotlight_stat IN ('reach','engagement','campaigns','trust'));

ALTER TABLE public.creators
  ADD COLUMN IF NOT EXISTS avatar_shape text NOT NULL DEFAULT 'circle';

ALTER TABLE public.creators
  DROP CONSTRAINT IF EXISTS creators_avatar_shape_check;
ALTER TABLE public.creators
  ADD CONSTRAINT creators_avatar_shape_check
  CHECK (avatar_shape IN ('circle','rounded'));

-- fn_get_evekit_profile: add the four new columns to the return set.
-- Spotlight stat *value* is deliberately NOT computed here -- reach,
-- campaign count, and trust score are all already returned via
-- separate fields/the platforms array, so evekit.html computes the
-- displayed number client-side from data it already has. This keeps
-- the function's shape stable and avoids a second source of truth for
-- numbers already being returned elsewhere in the same row.
DROP FUNCTION IF EXISTS public.fn_get_evekit_profile(text);

CREATE FUNCTION public.fn_get_evekit_profile(p_slug text)
RETURNS TABLE(
  display_name text, niche text, location text, bio text, business_email text,
  avatar_url text, cover_image_url text, gallery_images jsonb, available_for text[], causes text[], theme text,
  trust_score numeric, confidence numeric, badge_tier text, founding_cohort boolean,
  reliability_score numeric, verified_campaign_count bigint, profile_views integer,
  audience_countries jsonb, audience_genders jsonb, audience_ages jsonb,
  platforms jsonb, campaigns jsonb, collaborations jsonb, press_mentions jsonb,
  verified_since timestamptz,
  cover_pattern text, cover_tags text[], cover_spotlight_stat text, avatar_shape text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.display_name, c.niche, c.location, c.bio, c.business_email,
    c.avatar_url, c.cover_image_url, c.gallery_images, c.available_for, c.causes, c.theme,
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
    ),
    (SELECT min(pc.connected_at) FROM platform_connections pc
     WHERE pc.creator_id = c.id AND pc.verification_method = 'oauth'),
    c.cover_pattern, c.cover_tags, c.cover_spotlight_stat, c.avatar_shape
  FROM creators c
  JOIN profiles p ON p.id = c.id
  WHERE c.slug = p_slug AND c.is_test = false;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_get_evekit_profile(text) TO anon, authenticated;
