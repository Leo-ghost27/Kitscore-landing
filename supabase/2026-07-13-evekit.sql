-- EveKit reconciliation migration.
--
-- Context: fn_get_evekit_profile(), fn_increment_evekit_view(), and
-- creators.bio / creators.profile_views were already applied directly to
-- production (not through a tracked migration file) before this session
-- started. This migration does NOT recreate any of that -- it only adds
-- what's genuinely missing:
--   1. Extends fn_get_evekit_profile() to also return verified campaign
--      highlights (name + objective), not just a count. Requires DROP +
--      CREATE since the return signature is changing (Postgres won't let
--      CREATE OR REPLACE add a column to an existing RETURNS TABLE).
--      Everything else about the function is unchanged byte-for-byte.
--   2. Adds fn_set_evekit_slug() -- Pro-only custom vanity URL. Genuinely
--      new, nothing to conflict with.
--   3. A defensive length check on creators.bio (NOT VALID, so it only
--      applies going forward and won't choke on existing rows).
--
-- Explicitly NOT touched: fn_increment_evekit_view (already correct, already
-- writes to profile_views), creators.bio, creators.profile_views.

-- ── 1. fn_get_evekit_profile: add verified campaign highlights ──────────
DROP FUNCTION IF EXISTS public.fn_get_evekit_profile(text);

CREATE FUNCTION public.fn_get_evekit_profile(p_slug text)
RETURNS TABLE(
  display_name text,
  niche text,
  location text,
  bio text,
  business_email text,
  trust_score numeric,
  confidence numeric,
  badge_tier text,
  founding_cohort boolean,
  reliability_score numeric,
  verified_campaign_count bigint,
  profile_views integer,
  top_country text,
  top_country_pct smallint,
  age_range text,
  gender_split text,
  platforms jsonb,
  campaigns jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    p.display_name, c.niche, c.location, c.bio, c.business_email,
    c.trust_score, c.confidence::numeric, c.badge_tier, c.founding_cohort,
    c.reliability_score,
    (SELECT count(*) FROM campaigns cam WHERE cam.creator_id = c.id AND cam.creator_confirmed AND cam.sponsor_confirmed),
    c.profile_views,
    ad.top_country, ad.top_country_pct, ad.age_range, ad.gender_split,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
         'platform', pc.platform,
         'platform_handle', pc.platform_handle,
         'follower_count', pc.follower_count,
         'video_count', pc.video_count,
         'verification_method', pc.verification_method
       ) ORDER BY pc.follower_count DESC NULLS LAST)
       FROM platform_connections pc WHERE pc.creator_id = c.id AND pc.follower_count IS NOT NULL),
      '[]'::jsonb
    ),
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
         'name', cam.name,
         'objective', cam.objective,
         'completed_at', cam.completed_at
       ) ORDER BY cam.created_at DESC)
       FROM (
         SELECT * FROM campaigns cam2
         WHERE cam2.creator_id = c.id AND cam2.creator_confirmed AND cam2.sponsor_confirmed
         ORDER BY cam2.created_at DESC
         LIMIT 6
       ) cam),
      '[]'::jsonb
    )
  FROM creators c
  JOIN profiles p ON p.id = c.id
  LEFT JOIN audience_demographics ad ON ad.creator_id = c.id
  WHERE c.slug = p_slug AND c.is_test = false;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_get_evekit_profile(text) TO anon, authenticated;

-- ── 2. fn_set_evekit_slug: Pro-only custom vanity URL ────────────────────
CREATE OR REPLACE FUNCTION public.fn_set_evekit_slug(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_creator_id uuid := fn_current_profile_id();
  v_plan text;
  v_clean text := lower(trim(p_slug));
BEGIN
  IF v_creator_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not signed in.');
  END IF;

  SELECT plan INTO v_plan FROM public.creators WHERE id = v_creator_id;
  IF v_plan IS DISTINCT FROM 'pro' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Custom vanity URLs are a Pro feature.');
  END IF;

  IF v_clean !~ '^[a-z0-9-]{3,40}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Use 3-40 lowercase letters, numbers, or hyphens only.');
  END IF;

  IF EXISTS (SELECT 1 FROM public.creators WHERE slug = v_clean AND id <> v_creator_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That URL is already taken.');
  END IF;

  UPDATE public.creators SET slug = v_clean, updated_at = now() WHERE id = v_creator_id;
  RETURN jsonb_build_object('ok', true, 'slug', v_clean);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_set_evekit_slug(text) TO authenticated;

-- ── 3. Defensive bio length check (NOT VALID: future rows only) ─────────
ALTER TABLE public.creators
  ADD CONSTRAINT creators_bio_length CHECK (char_length(bio) <= 280) NOT VALID;
