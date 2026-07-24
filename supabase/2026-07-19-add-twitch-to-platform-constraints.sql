-- Backfill: this migration was applied directly to the live database on
-- 2026-07-19 (Supabase migration history: version 20260719020818, name
-- "add_twitch_to_platform_constraints") but never committed to this repo.
-- SQL below is pulled verbatim from supabase_migrations.schema_migrations,
-- not reconstructed -- this file exists purely to close the audit-trail
-- gap between what's live and what's in git.

ALTER TABLE public.platform_connections DROP CONSTRAINT platform_connections_platform_check;
ALTER TABLE public.platform_connections ADD CONSTRAINT platform_connections_platform_check
  CHECK (platform = ANY (ARRAY['youtube'::text, 'tiktok'::text, 'instagram'::text, 'twitch'::text]));

ALTER TABLE public.oauth_states DROP CONSTRAINT oauth_states_platform_check;
ALTER TABLE public.oauth_states ADD CONSTRAINT oauth_states_platform_check
  CHECK (platform = ANY (ARRAY['youtube'::text, 'tiktok'::text, 'instagram'::text, 'twitch'::text]));
