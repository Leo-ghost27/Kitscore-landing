-- 2026-07-31f-brand-safety-flagged-titles.sql
--
-- The review checklist's key step -- "go watch the actual video, don't
-- approve/reject off the rationale text alone" -- was hard to act on:
-- the rationale only cites titles in prose, with no link. Adding a
-- flagged_titles array so the scanner records exactly which video
-- title(s) it matched, letting the admin page join against
-- creator_videos and render a direct "Watch on YouTube" link per
-- flagged video.
ALTER TABLE public.brand_safety_scans
  ADD COLUMN IF NOT EXISTS flagged_titles text[] NOT NULL DEFAULT '{}';
