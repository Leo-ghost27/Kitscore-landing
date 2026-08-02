-- 2026-08-01b-creator-videos-paid-promotion-flag.sql
--
-- Adds the field that makes disclosure_scans deterministic instead of
-- LLM-guessed. YouTube's Data API exposes paidProductPlacementDetails on
-- the *videos* resource (not playlistItems, which is all fetchYoutubeUploads
-- called until now) -- a boolean the creator explicitly set at upload time
-- to say "this video has paid promotion in it," retrievable by the video
-- owner. That's YouTube's own record of what the creator declared, not an
-- LLM inferring "this sounds sponsored" from a title -- strictly stronger
-- signal, and it removes the ANTHROPIC_API_KEY dependency for this feature
-- entirely (see lib/disclosure-check.js, replacing lib/disclosure-scan.js).
--
-- Nullable/default false rather than a NOT NULL constraint: existing rows
-- predate this column and were never fetched with this field, so they
-- should read as "unknown," not "no paid promotion" -- the caller treats
-- null and false differently (null = don't flag, we don't actually know).

ALTER TABLE public.creator_videos
  ADD COLUMN IF NOT EXISTS has_paid_promotion boolean;
