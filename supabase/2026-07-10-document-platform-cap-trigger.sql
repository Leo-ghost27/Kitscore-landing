-- 2026-07-10-document-platform-cap-trigger.sql
--
-- DOCUMENTATION-ONLY CATCH-UP MIGRATION.
--
-- fn_enforce_platform_cap() and its two triggers (trg_enforce_platform_cap_evidence
-- on evidence_uploads, trg_enforce_platform_cap_connections on platform_connections)
-- have been live in production since the free-tier platform cap was built, but were
-- never committed to a .sql file -- an undocumented direct-to-production change.
-- This migration commits the function/triggers exactly as pulled from production via
-- pg_get_functiondef / pg_get_triggerdef on 2026-07-10, using CREATE OR REPLACE /
-- DROP+CREATE so it is a no-op against the current database. No behavior change.
--
-- Behavior as currently deployed: a creator on the free plan (not 'pro', not
-- founding_cohort) is capped at ONE distinct platform, counted across
-- evidence_uploads.platform and platform_connections.platform combined. This
-- does NOT distinguish verification_method -- a free-tier handle-lookup
-- (public_lookup) connection is capped identically to an OAuth-verified one.
-- Flagged separately for a product-intent decision; not changed here.

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

  SELECT array_agg(DISTINCT p) INTO v_existing_platforms FROM (
    SELECT lower(platform) AS p FROM evidence_uploads WHERE creator_id = NEW.creator_id AND platform IS NOT NULL
    UNION
    SELECT lower(platform) AS p FROM platform_connections WHERE creator_id = NEW.creator_id
  ) sub;

  IF v_existing_platforms IS NOT NULL
     AND array_length(v_existing_platforms, 1) >= 1
     AND NOT (v_new_platform = ANY(v_existing_platforms)) THEN
    RAISE EXCEPTION 'PLATFORM_CAP: Free plan is limited to one platform. Upgrade to Pro for unlimited platforms.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_platform_cap_evidence ON public.evidence_uploads;
CREATE TRIGGER trg_enforce_platform_cap_evidence
  BEFORE INSERT ON public.evidence_uploads
  FOR EACH ROW EXECUTE FUNCTION fn_enforce_platform_cap();

DROP TRIGGER IF EXISTS trg_enforce_platform_cap_connections ON public.platform_connections;
CREATE TRIGGER trg_enforce_platform_cap_connections
  BEFORE INSERT ON public.platform_connections
  FOR EACH ROW EXECUTE FUNCTION fn_enforce_platform_cap();
