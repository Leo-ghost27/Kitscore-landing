-- EveKit: the free, pitch-ready media kit creators send to brands cold.
-- Distinct from p.html (the minimal, always-current verification link).
-- See docs/session-handoff-2026-07-13-evekit.md for the full design writeup.
--
-- This migration:
--   1. Adds a short creator-written `bio` field (used on EveKit only, not p.html).
--   2. Adds aggregate view-count tracking for EveKit links (Pro perk: see it).
--   3. Adds fn_get_public_evekit() -- the public, unauthenticated read powering
--      the shareable ?slug= link, analogous to fn_get_public_profile() but
--      with the extra pitch-relevant fields a trust-check link deliberately
--      leaves out (bio, contact email, platform follower counts, rate card
--      inputs, campaign highlights with objectives).
--   4. Adds fn_increment_evekit_view() -- called once per anonymous page load
--      from evekit.html, not from the owner's own authenticated preview.
--   5. Adds fn_set_evekit_slug() -- lets Pro creators claim a custom vanity
--      slug (e.g. kitscore.co/app/p.html?slug=jordan-fitness instead of the
--      random default). Free creators keep their auto-generated slug.

-- ── 1. Bio ───────────────────────────────────────────────────────────────
-- Self-written, not scored. Capped at 280 chars in the app UI (enforced
-- client-side in profile.html; also capped here as a defensive backstop).
ALTER TABLE public.creators ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE public.creators ADD CONSTRAINT creators_bio_length CHECK (char_length(bio) <= 280) NOT VALID;

-- ── 2. View tracking (aggregate only -- no visitor identity is collected) ──
ALTER TABLE public.creators ADD COLUMN IF NOT EXISTS evekit_view_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.creators ADD COLUMN IF NOT EXISTS evekit_last_viewed_at timestamptz;

-- ── 3. fn_get_public_evekit ─────────────────────────────────────────────
-- No access_token/refresh_token, no sponsor-side campaign fields (dispute
-- reasons, internal ratings) -- same "public means public" discipline as
-- fn_get_public_profile/fn_get_public_endorsements. business_email IS
-- included deliberately: EveKit exists so a brand can act on it, and a
-- creator only gets a slug (and therefore an EveKit link) by choosing to
-- share it.
CREATE OR REPLACE FUNCTION public.fn_get_public_evekit(p_slug text)
RETURNS TABLE(
  display_name text,
  bio text,
  niche text,
  location text,
  business_email text,
  trust_score numeric,
  confidence numeric,
  badge_tier text,
  founding_cohort boolean,
  verified_campaign_count bigint,
  reliability_score numeric,
  would_hire_again_pct numeric,
  repeat_sponsor_rate numeric,
  platforms jsonb,
  campaigns jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH creator_row AS (
    SELECT c.id, c.niche, c.location, c.business_email, c.trust_score, c.confidence,
           c.badge_tier, c.founding_cohort, c.reliability_score, c.would_hire_again_pct,
           c.repeat_sponsor_rate, c.bio, p.display_name
    FROM public.creators c
    JOIN public.profiles p ON p.id = c.id
    WHERE c.slug = p_slug AND c.is_test = false
  ),
  verified AS (
    SELECT cam.name, cam.objective, cam.created_at
    FROM public.campaigns cam, creator_row cr
    WHERE cam.creator_id = cr.id AND cam.creator_confirmed AND cam.sponsor_confirmed
    ORDER BY cam.created_at DESC
    LIMIT 6
  ),
  platform_rows AS (
    SELECT pc.platform, pc.platform_handle, pc.verification_method, pc.follower_count
    FROM public.platform_connections pc, creator_row cr
    WHERE pc.creator_id = cr.id AND pc.follower_count IS NOT NULL
    ORDER BY pc.follower_count DESC
  )
  SELECT
    cr.display_name,
    cr.bio,
    cr.niche,
    cr.location,
    cr.business_email,
    cr.trust_score,
    cr.confidence,
    cr.badge_tier,
    cr.founding_cohort,
    (SELECT count(*) FROM verified),
    cr.reliability_score,
    cr.would_hire_again_pct,
    cr.repeat_sponsor_rate,
    COALESCE((SELECT jsonb_agg(to_jsonb(platform_rows)) FROM platform_rows), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(to_jsonb(verified)) FROM verified), '[]'::jsonb)
  FROM creator_row cr;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_public_evekit(text) TO anon, authenticated;

-- ── 4. fn_increment_evekit_view ─────────────────────────────────────────
-- Deliberately coarse: a running count + last-viewed timestamp, nothing
-- that identifies who looked. evekit.html calls this once per anonymous
-- page load (skipped when the visitor has an active session, so a
-- creator's own preview of their own kit doesn't inflate the count).
CREATE OR REPLACE FUNCTION public.fn_increment_evekit_view(p_slug text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.creators
  SET evekit_view_count = evekit_view_count + 1,
      evekit_last_viewed_at = now()
  WHERE slug = p_slug AND is_test = false;
$$;

GRANT EXECUTE ON FUNCTION public.fn_increment_evekit_view(text) TO anon, authenticated;

-- ── 5. fn_set_evekit_slug ────────────────────────────────────────────────
-- Pro-only vanity URL. Free creators keep whatever slug they were assigned
-- at signup. Validates format (lowercase letters/numbers/hyphens, 3-40
-- chars) and uniqueness; returns a jsonb {ok, error} result rather than
-- raising, so the UI can show a clean inline message.
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
