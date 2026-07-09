-- 2026-07-09-platform-connections.sql
--
-- First build pass on live platform verification (OAuth platform
-- verification project). Today, "platform" on a creator's profile is just
-- free text on the evidence table (evidence.platform), entered manually
-- alongside a screenshot -- there's no live data pull from any social API
-- anywhere in this schema. This adds the plumbing for two paths:
--
--   1. YouTube: public channel stats (subscriber/view/video count) via an
--      API key, no OAuth. This proves nothing about ownership -- it's a
--      "linked" channel, not a "verified" one -- see the verification_method
--      column below.
--   2. TikTok: full OAuth 2.0 Login Kit flow, which does prove ownership
--      (the creator authenticated directly with TikTok and granted
--      consent), hence verification_method = 'oauth'.
--
-- Instagram is deliberately not included in this pass -- Meta's app review
-- (2-4 weeks per permission, Business account + linked Facebook Page
-- required) makes it a separate, later project, not something to schema
-- for speculatively today.
--
-- Follows the established safety pattern for this schema: RLS is enabled
-- on both new tables but with NO policies granted to anon/authenticated --
-- every read and write goes through the service-role admin client inside
-- api/*.js (see api/connect-youtube.js, api/tiktok-oauth-start.js,
-- api/tiktok-oauth-callback.js). This is deliberate, not an oversight:
-- access_token/refresh_token columns must never be reachable by a client
-- session, and a raw RLS policy is the wrong tool to carve out "some
-- columns are fine, some aren't" -- Postgres RLS is row-level, not
-- column-level. Safe, non-token fields are exposed instead through the
-- fn_creator_platform_summary() SECURITY DEFINER function at the bottom,
-- which is the same pattern fn_team_clients/fn_team_roster use elsewhere
-- in this schema.

-- =============================================================
-- 1. platform_connections
-- =============================================================
CREATE TABLE public.platform_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  creator_id uuid NOT NULL REFERENCES public.creators(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'instagram')),

  -- Identity on the external platform.
  platform_user_id text NOT NULL,
  platform_handle text,

  -- 'public_lookup' = data pulled via a public API/API key, ownership not
  -- proven (today: YouTube). 'oauth' = creator authenticated directly with
  -- the platform and granted consent (today: TikTok). Anywhere this is
  -- surfaced to a sponsor, public_lookup connections must be labelled
  -- "linked" and oauth connections may be labelled "verified" -- do not
  -- blur this distinction in the UI.
  verification_method text NOT NULL CHECK (verification_method IN ('public_lookup', 'oauth')),

  -- OAuth token material. Only ever populated for verification_method =
  -- 'oauth'; null for public_lookup connections. Never selected by
  -- anything other than the admin client.
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text,

  -- Cached discovery-reach numbers, refreshed by whichever job/endpoint
  -- last synced this row (see last_synced_at). These are a cache, not a
  -- live value -- always read last_synced_at alongside them so staleness
  -- can be shown, same spirit as evidence_uploads.last_expiry_nudge_sent_at.
  follower_count bigint,
  video_count bigint,
  view_count bigint,

  last_synced_at timestamptz,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One connection per creator per platform. Reconnecting (e.g. re-running
  -- the TikTok OAuth flow, or re-looking-up a YouTube handle) upserts this
  -- row rather than creating a duplicate.
  UNIQUE (creator_id, platform)
);

CREATE INDEX platform_connections_creator_id_idx ON public.platform_connections(creator_id);

ALTER TABLE public.platform_connections ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies here -- see file header. All access is via the
-- service-role admin client in api/*.js.

-- =============================================================
-- 2. oauth_states
-- =============================================================
-- Short-lived CSRF/replay-protection rows for the OAuth redirect round
-- trip. api/tiktok-oauth-start.js writes a row before redirecting the
-- browser to TikTok; api/tiktok-oauth-callback.js deletes-and-checks it
-- when TikTok redirects back, which is also what recovers *which* creator
-- this callback belongs to (the callback request itself carries no
-- Authorization header -- it's a browser navigation TikTok controls, not
-- an authenticated fetch from our own frontend).
CREATE TABLE public.oauth_states (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  creator_id uuid NOT NULL REFERENCES public.creators(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('youtube', 'tiktok', 'instagram')),
  state text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX oauth_states_state_idx ON public.oauth_states(state);

ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
-- Same reasoning as platform_connections: no policies, admin-client only.

-- Rows should live for minutes at most (a user either completes the
-- TikTok consent screen or abandons it). Nothing currently purges
-- abandoned rows -- if this becomes a real cron job later, follow the
-- scripts/send-evidence-expiry-nudges.js manually-run-script pattern
-- rather than adding a pg_cron dependency for a handful of orphaned rows.

-- =============================================================
-- 3. fn_creator_platform_summary -- safe, token-free read
-- =============================================================
-- Returns only what's safe to show a sponsor or display publicly on a
-- creator's trust profile: which platforms are connected, at what
-- verification strength, and the last-synced discovery numbers. Never
-- returns access_token/refresh_token. SECURITY DEFINER so it can read the
-- underlying table despite the table itself having no RLS policies for
-- authenticated/anon roles, same shape as fn_team_clients.
CREATE OR REPLACE FUNCTION public.fn_creator_platform_summary(p_creator_id uuid)
RETURNS TABLE(
  platform text,
  platform_handle text,
  verification_method text,
  follower_count bigint,
  video_count bigint,
  view_count bigint,
  last_synced_at timestamptz,
  connected_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT platform, platform_handle, verification_method,
         follower_count, video_count, view_count,
         last_synced_at, connected_at
  FROM public.platform_connections
  WHERE creator_id = p_creator_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_creator_platform_summary(uuid) TO anon, authenticated;
