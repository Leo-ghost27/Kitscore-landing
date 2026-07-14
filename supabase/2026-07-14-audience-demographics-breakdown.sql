-- Replace single-value audience_demographics with a multi-row breakdown,
-- matching how platform analytics (Instagram/TikTok/YouTube) and
-- third-party creator tools (HypeAuditor, Modash, etc.) report audience
-- data: multiple countries with their own %, gender as %female/%male/
-- %other, age as % per standard bracket -- rather than one dominant
-- country/age/gender per creator.
--
-- Context: applied directly to production via the Supabase connector
-- (see the RLS-fix session earlier the same day, which also found and
-- fixed the missing SELECT policy on the old single-value table). This
-- file exists purely to keep the migration history in this repo
-- consistent with what's actually live -- the DDL below is exactly what
-- was run.
--
-- Table name is kept (audience_demographics), shape changes from
-- one-row-per-creator to one-row-per-(creator, dimension, label).
-- The one existing production row (a test save on the Eve Hamza account)
-- was migrated in place: country as-is, "25" age -> 25-34 bracket,
-- "80%Female 20%male" free text -> female 80 / male 20.

-- ── 1. Schema replacement ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audience_demographics_new (
  creator_id uuid NOT NULL REFERENCES public.creators(id) ON DELETE CASCADE,
  dimension text NOT NULL,
  label text NOT NULL,
  pct smallint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (creator_id, dimension, label),
  CONSTRAINT audience_demographics_pct_check CHECK (pct >= 0 AND pct <= 100),
  CONSTRAINT audience_demographics_dimension_check CHECK (dimension IN ('country','gender','age')),
  CONSTRAINT audience_demographics_label_check CHECK (
    (dimension = 'gender' AND label IN ('female','male','other')) OR
    (dimension = 'age' AND label IN ('13-17','18-24','25-34','35-44','45-54','55-64','65+')) OR
    (dimension = 'country' AND length(label) BETWEEN 1 AND 60)
  )
);
-- (In production this ran as DROP + CREATE of audience_demographics
-- itself, with the one existing row carried over first -- see the
-- migration notes above. Written here as a _new table + swap so this
-- file is safe to re-run against a fresh database that doesn't have the
-- old shape at all.)
DROP TABLE IF EXISTS public.audience_demographics;
ALTER TABLE public.audience_demographics_new RENAME TO audience_demographics;

ALTER TABLE public.audience_demographics ENABLE ROW LEVEL SECURITY;

-- Creators can read their own breakdown (this was the actual bug fixed
-- earlier today -- PostgREST always runs INSERT/UPSERT with RETURNING,
-- which is checked against SELECT policies too, so saves failed RLS
-- with only the sponsor-read and creator-write policies in place).
CREATE POLICY audience_demographics_select_own
ON public.audience_demographics FOR SELECT
USING (creator_id = fn_current_profile_id() OR fn_is_admin());

CREATE POLICY audience_demographics_sponsor_read
ON public.audience_demographics FOR SELECT
USING (fn_current_role() = 'sponsor'::user_role);

CREATE POLICY audience_demographics_insert_own
ON public.audience_demographics FOR INSERT
WITH CHECK (creator_id = fn_current_profile_id() OR fn_is_admin());

CREATE POLICY audience_demographics_update_own
ON public.audience_demographics FOR UPDATE
USING (creator_id = fn_current_profile_id() OR fn_is_admin())
WITH CHECK (creator_id = fn_current_profile_id() OR fn_is_admin());

CREATE POLICY audience_demographics_delete_own
ON public.audience_demographics FOR DELETE
USING (creator_id = fn_current_profile_id() OR fn_is_admin());

-- ── 2. fn_get_evekit_profile: return breakdown arrays instead of scalars ─
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
  audience_countries jsonb,
  audience_genders jsonb,
  audience_ages jsonb,
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
  WHERE c.slug = p_slug AND c.is_test = false;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_get_evekit_profile(text) TO anon, authenticated;
