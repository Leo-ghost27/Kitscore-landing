-- 2026-07-25-add-discord-to-oauth-states-check.sql
--
-- Real bug, reproduced live: discord-oauth-start.js has been failing on
-- every single attempt since it shipped -- the INSERT into oauth_states
-- hits 'new row for relation "oauth_states" violates check constraint
-- "oauth_states_platform_check"' because the constraint's allow-list
-- (youtube, tiktok, instagram, twitch) was never updated when Discord
-- OAuth was added. Confirmed zero oauth_states rows for platform=
-- 'discord' exist across the table's full 15-day history -- this was
-- never once working, not a regression.

-- Also found while checking for the same gap elsewhere (this bug class
-- tends to repeat one constraint at a time): platform_connections has an
-- identical check constraint missing 'discord' too. This would have been
-- the very next failure -- once oauth_states accepts the insert, the
-- callback's final step (lib/handlers/discord-oauth-callback.js) upserts
-- into platform_connections with platform: 'discord', which would hit
-- the exact same violation. Fixing both in one migration rather than
-- discovering this the same way, one bug report at a time.

ALTER TABLE public.oauth_states DROP CONSTRAINT oauth_states_platform_check;

ALTER TABLE public.oauth_states ADD CONSTRAINT oauth_states_platform_check
  CHECK (platform = ANY (ARRAY['youtube'::text, 'tiktok'::text, 'instagram'::text, 'twitch'::text, 'discord'::text]));

ALTER TABLE public.platform_connections DROP CONSTRAINT platform_connections_platform_check;

ALTER TABLE public.platform_connections ADD CONSTRAINT platform_connections_platform_check
  CHECK (platform = ANY (ARRAY['youtube'::text, 'tiktok'::text, 'instagram'::text, 'twitch'::text, 'discord'::text]));
