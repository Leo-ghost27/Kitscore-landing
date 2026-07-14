-- 2026-07-13-creator-videos.sql
--
-- Stores per-video metadata (title, description, publishedAt) fetched via
-- OAuth from a creator's own uploads playlist. Feeds two features:
--   1. content_consistency_youtube -- posting cadence, computed from
--      publishedAt dates (see lib/google-oauth.js computeContentConsistency)
--   2. brand_safety text scan (upcoming) -- LLM classification of
--      title/description text, supplementing the self-report questionnaire
--
-- One row per video. Refreshed on each YouTube OAuth (re)connect via
-- fetchYoutubeUploads -- no separate cron yet, so data is only as fresh as
-- the creator's last (re)connect. RLS: enabled with zero policies, same
-- deny-all-by-default pattern as platform_connections -- only the service
-- role (OAuth callback handlers, admin client) touches this table.
-- Nothing in the frontend needs direct access to raw titles/descriptions;
-- only the derived scores (content_consistency_youtube, and the upcoming
-- brand_safety scan) are ever surfaced, both already exposed through
-- score_components' existing access pattern.

CREATE TABLE IF NOT EXISTS public.creator_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES public.creators(id) ON DELETE CASCADE,
  platform text NOT NULL,
  video_id text NOT NULL,
  title text,
  description text,
  published_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creator_id, platform, video_id)
);

CREATE INDEX IF NOT EXISTS idx_creator_videos_creator_id ON public.creator_videos(creator_id);

ALTER TABLE public.creator_videos ENABLE ROW LEVEL SECURITY;
-- No policies added -- deny-all for anon/authenticated by design; only
-- the service role (bypasses RLS) reads/writes this table.
