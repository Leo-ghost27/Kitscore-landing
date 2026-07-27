-- Applied directly to production during a trust/confidence calculation
-- audit (see the two files below for why). Instagram's Graph API
-- response already includes media_count -- fetchInstagramOwnUser() in
-- lib/instagram.js was fetching it all along -- but
-- instagram-oauth-callback.js was discarding it instead of storing it.
-- Needed to support an authenticity plausibility check for Instagram
-- (see 2026-07-27-fix-instagram-audience-authenticity-gap.sql).

ALTER TABLE public.platform_connections ADD COLUMN IF NOT EXISTS media_count bigint;
COMMENT ON COLUMN public.platform_connections.media_count IS 'Instagram Graph API media_count (total posts). Already fetched by fetchInstagramOwnUser() but was previously discarded, not stored -- added to support an authenticity plausibility check (very high follower count with near-zero post count is a classic purchased-followers signal), same reasoning as the Twitch/TikTok/YouTube checks already covering those platforms.';
