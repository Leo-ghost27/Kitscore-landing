-- 2026-07-10-dedupe-cap-and-gate-engagement-quality.sql
--
-- Two follow-ups found while reconciling with a parallel session's work
-- on the same scoring-integrity issues (their migrations:
-- 2026-07-10-scoring-fixes-and-platform-engagement.sql,
-- consolidate_confidence_formula_v2, normalize_stale_component_weights):
--
--   1. Two platform-cap enforcement triggers ended up live at once --
--      fn_enforce_platform_cap (checks evidence_uploads AND
--      platform_connections together) and fn_enforce_platform_limit
--      (evidence_uploads only, so it misses the case where a creator's
--      only "platform" so far is a linked connection, not evidence).
--      Not corrupting anything (fn_enforce_platform_cap fires first
--      alphabetically and covers the gap), but redundant. Dropping the
--      narrower one.
--
--   2. fn_recalc_engagement_quality wires YouTube reach-efficiency
--      (views/video relative to subscribers) into a real trust_score
--      component, inserted with status = 'live_verified', for ANY
--      platform_connections row regardless of verification_method.
--      connect-platform.js has no ownership check -- a public_lookup
--      connection proves the channel exists, not that the linking
--      creator owns it. That makes this component spoofable (link any
--      public handle, however famous, and its numbers move your
--      trust_score) and mislabeled (public_lookup data displayed with
--      the same "live_verified" status used for genuinely verified
--      evidence). The reach-efficiency tiering itself is good design --
--      keeping it, just gating it to verification_method = 'oauth' so it
--      goes live automatically once TikTok (or YouTube) OAuth exists,
--      instead of running on unverified data today.

-- ── 1. Drop the narrower, redundant platform-cap trigger ────────────────
DROP TRIGGER IF EXISTS trg_enforce_platform_limit ON public.evidence_uploads;
DROP FUNCTION IF EXISTS public.fn_enforce_platform_limit();

-- ── 2. Gate engagement_quality to OAuth-verified connections only ───────
DROP TRIGGER IF EXISTS trg_recalc_engagement_quality ON public.platform_connections;

CREATE TRIGGER trg_recalc_engagement_quality
  AFTER INSERT OR UPDATE OF follower_count, video_count, view_count ON public.platform_connections
  FOR EACH ROW
  WHEN (NEW.platform = 'youtube' AND NEW.verification_method = 'oauth')
  EXECUTE FUNCTION public.fn_recalc_engagement_quality();

-- Any engagement_quality component row already written by the unrestricted
-- version of this trigger came from unverified public_lookup data and
-- needs a human decision (what value to fall back to), not a guess here --
-- see docs/session-handoff for which creators are affected and current
-- values pending review.
