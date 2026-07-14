-- 2026-07-13-rename-content-consistency-youtube.sql
--
-- Same pattern as 2026-07-10-rename-engagement-quality-youtube.sql.
-- content_consistency was previously self-report/admin-review (creator
-- uploads evidence, admin eyeballs it via evidence.html). As of this
-- session it's computed from real OAuth data instead -- posting cadence
-- over the trailing 8 weeks, from the creator's own upload history (see
-- lib/google-oauth.js computeContentConsistency, wired into
-- lib/handlers/youtube-oauth-callback.js). Renaming the key ahead of a
-- future content_consistency_tiktok so the two don't collide on the same
-- row once TikTok's OAuth review clears.
--
-- Existing rows are renamed in place -- their value stays whatever the
-- creator's old self-reported evidence produced until they next
-- (re)connect YouTube via OAuth, at which point the callback handler
-- overwrites it with the real computed value. No score change from this
-- migration alone.

UPDATE public.score_components
SET component_key = 'content_consistency_youtube',
    label = 'Content consistency (YouTube)',
    updated_at = now()
WHERE component_key = 'content_consistency';
