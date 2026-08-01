-- 2026-08-01-disclosure-scan.sql
--
-- Phase 1 of real FTC/ad-disclosure checking. Previously this was 100%
-- self-reported: the brand_safety_answers.paid_disclosure question
-- (Always/Inconsistent/Never) and contracts.ftc_disclosure_required were
-- the only things touching this dimension, and nothing ever checked a
-- creator's actual posts. Held on 2026-07-08 pending OAuth access
-- (see session-handoff-2026-07-08-v34.md) and again deliberately excluded
-- from the brand_safety_scan automation on 2026-07-13 (see
-- fn_admin_apply_brand_safety_scan's comments) -- both blockers were
-- "we don't actually have real post text to check yet."
--
-- YouTube OAuth already pulls title/description into creator_videos
-- (2026-07-13-creator-videos.sql), so that blocker is now gone for
-- YouTube specifically. Instagram/TikTok/Twitch do NOT currently fetch
-- caption/post text via their OAuth libs -- that's a separate, later
-- lift (each platform's lib + API scope needs a change first), not
-- something this migration pretends to cover.
--
-- Deliberately narrow scope, matching the brand_safety_scan precedent:
--   - Detects a *pattern* (suspected sponsored content without a visible
--     #ad/#sponsored/paid-partnership marker in title or description) --
--     it is NOT a legal determination of FTC "clear and conspicuous"
--     compliance, which depends on placement/context a text scanner
--     can't certify. This is flagged in the UI copy, not just here.
--   - Flag-only. Unlike brand_safety_scans, approving a flag here does
--     NOT touch score_components or any contract/escrow state -- that
--     was explicitly deferred pending a separate decision on whether
--     disclosure findings should ever gate money movement. This table
--     exists purely to give admins real visibility instead of trusting
--     the self-report blind, and to build a track record before any
--     scoring/gating decision is made on top of it.

CREATE TABLE IF NOT EXISTS public.disclosure_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES public.creators(id) ON DELETE CASCADE,
  platform text NOT NULL,
  flagged boolean NOT NULL,
  suspected_titles text[] NOT NULL DEFAULT '{}',
  rationale text,
  model text NOT NULL,
  video_count_scanned integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'clean', -- clean | pending_review | acknowledged | dismissed
  scanned_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CHECK (status IN ('clean', 'pending_review', 'acknowledged', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_disclosure_scans_creator_id ON public.disclosure_scans(creator_id);
CREATE INDEX IF NOT EXISTS idx_disclosure_scans_status ON public.disclosure_scans(status);

ALTER TABLE public.disclosure_scans ENABLE ROW LEVEL SECURITY;

-- Same admin-only pattern as brand_safety_scans / evidence_uploads.
-- No creator-facing access -- a creator never sees which of their own
-- posts got flagged, only admins reviewing the queue.
CREATE POLICY disclosure_scans_admin_only ON public.disclosure_scans
  FOR ALL
  USING (fn_is_admin())
  WITH CHECK (fn_is_admin());

-- No fn_admin_apply_* function, unlike brand safety -- there is no score
-- to apply. Status changes (pending_review -> acknowledged/dismissed) are
-- a plain update from the admin page, same pattern admin-evidence.html
-- already uses for evidence_uploads (see app/admin-evidence.html), gated
-- by the RLS policy above rather than a dedicated RPC.
