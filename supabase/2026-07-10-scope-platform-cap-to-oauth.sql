-- 2026-07-10-scope-platform-cap-to-oauth.sql
--
-- Behavior change (confirmed with Gina 2026-07-10), not documentation-only.
--
-- Previously fn_enforce_platform_cap() capped free-tier creators at ONE
-- distinct platform, counted across evidence_uploads.platform AND
-- platform_connections.platform combined, regardless of verification_method.
-- That meant self-reported evidence and free handle-lookup (public_lookup)
-- connections were rationed the same as OAuth-verified ones, even though
-- neither feeds the trust score today (only oauth youtube connections do,
-- via fn_recalc_engagement_quality) and both are cheap to serve.
--
-- New rule:
--   - evidence_uploads.platform: uncapped, all plans. Self-reported evidence
--     never blends into the verified score (see methodology.html), so
--     rationing it added no integrity value, just friction.
--   - platform_connections, verification_method = 'public_lookup': uncapped,
--     all plans. Handle-only, unverified, no score impact -- free to serve,
--     helps free profiles look fuller for sponsors browsing the directory.
--   - platform_connections, verification_method = 'oauth': still capped at
--     ONE for free-plan / non-founding creators. This is the only connection
--     type that currently affects trust score and the only one Pro is
--     actually charging for ("Unlimited connected platforms" on the Pro
--     card refers to OAuth-verified platforms).
--
-- The evidence_uploads cap trigger is dropped entirely (evidence_uploads has
-- no verification_method column -- it was never distinguishable there, so
-- capping it was always a blunt instrument). The platform_connections
-- trigger gets a WHEN clause so it only fires for oauth rows, and the
-- function drops the evidence_uploads UNION since it's no longer relevant.

-- ── 1. Evidence uploads: drop the cap entirely ──────────────────────────
DROP TRIGGER IF EXISTS trg_enforce_platform_cap_evidence ON public.evidence_uploads;

-- ── 2. Rewrite the function to only ever be reached by oauth rows ───────
CREATE OR REPLACE FUNCTION public.fn_enforce_platform_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_unlimited boolean;
  v_new_platform text;
  v_existing_platforms text[];
BEGIN
  SELECT (plan = 'pro' OR founding_cohort) INTO v_is_unlimited
  FROM creators WHERE id = NEW.creator_id;

  IF v_is_unlimited THEN
    RETURN NEW;
  END IF;

  v_new_platform := lower(NEW.platform);
  IF v_new_platform IS NULL OR v_new_platform = '' THEN
    RETURN NEW;
  END IF;

  -- Only count OAuth-verified connections toward the cap. public_lookup
  -- rows and evidence_uploads are handled by the WHEN clause / dropped
  -- trigger above and never reach this function.
  SELECT array_agg(DISTINCT lower(platform)) INTO v_existing_platforms
  FROM platform_connections
  WHERE creator_id = NEW.creator_id AND verification_method = 'oauth';

  IF v_existing_platforms IS NOT NULL
     AND array_length(v_existing_platforms, 1) >= 1
     AND NOT (v_new_platform = ANY(v_existing_platforms)) THEN
    RAISE EXCEPTION 'PLATFORM_CAP: Free plan is limited to one OAuth-verified platform. Upgrade to Pro for unlimited platforms.';
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 3. Re-point the platform_connections trigger to oauth rows only ─────
DROP TRIGGER IF EXISTS trg_enforce_platform_cap_connections ON public.platform_connections;
CREATE TRIGGER trg_enforce_platform_cap_connections
  BEFORE INSERT ON public.platform_connections
  FOR EACH ROW
  WHEN (NEW.verification_method = 'oauth')
  EXECUTE FUNCTION fn_enforce_platform_cap();
