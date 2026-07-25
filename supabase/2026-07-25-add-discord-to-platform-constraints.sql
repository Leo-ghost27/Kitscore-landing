-- Adds 'discord' as a valid platform value, same shape as the Twitch
-- addition in 2026-07-19-add-twitch-to-platform-constraints.sql. Apply
-- via `supabase db push` (or the Supabase dashboard SQL editor) before
-- the Discord OAuth code paths go live -- the callback's upsert into
-- platform_connections will fail its CHECK constraint otherwise.

ALTER TABLE public.platform_connections DROP CONSTRAINT platform_connections_platform_check;
ALTER TABLE public.platform_connections ADD CONSTRAINT platform_connections_platform_check
  CHECK (platform = ANY (ARRAY['youtube'::text, 'tiktok'::text, 'instagram'::text, 'twitch'::text, 'discord'::text]));

ALTER TABLE public.oauth_states DROP CONSTRAINT oauth_states_platform_check;
ALTER TABLE public.oauth_states ADD CONSTRAINT oauth_states_platform_check
  CHECK (platform = ANY (ARRAY['youtube'::text, 'tiktok'::text, 'instagram'::text, 'twitch'::text, 'discord'::text]));
