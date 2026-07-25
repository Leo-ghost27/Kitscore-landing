-- Reconciles two parallel-built follower-tracking tables:
--
-- platform_follower_history: built and wired into production dashboard
-- code same-day (2026-07-23) -- trg_capture_follower_history trigger,
-- fn_creator_follower_history RPC, the Tools tab follower-growth
-- sparkline all read from this table.
--
-- platform_follower_snapshots: built independently in a parallel session
-- (Claude Code or another chat, working on Kitscore concurrently, per
-- conversation with the user 2026-07-25) -- same purpose, never wired
-- into any UI or trigger. Had one design choice worth keeping: a
-- UNIQUE(creator_id, platform, recorded_at) constraint that
-- platform_follower_history lacked.
--
-- Consolidated onto platform_follower_history since it's the one
-- already live and deployed -- rewiring working, deployed code to a
-- different table would be strictly more risk for no benefit. Adopted
-- the missing UNIQUE constraint, and preserved all 7 of the other
-- session's rows via a dedup'd migration (ON CONFLICT DO NOTHING)
-- rather than silently discarding them. Verified 10 + 7 = 17 rows
-- post-migration, zero data loss.
--
-- Applied live via Supabase MCP's apply_migration (properly recorded in
-- supabase_migrations.schema_migrations this time, unlike some of this
-- session's earlier changes which used raw execute_sql and only exist
-- as hand-written files in this repo -- worth reconciling those
-- properly at some point too).

ALTER TABLE public.platform_follower_history
  ADD CONSTRAINT platform_follower_history_creator_platform_recorded_key
  UNIQUE (creator_id, platform, recorded_at);

INSERT INTO public.platform_follower_history (creator_id, platform, follower_count, recorded_at)
SELECT creator_id, platform, follower_count, recorded_at
FROM public.platform_follower_snapshots
WHERE follower_count IS NOT NULL
ON CONFLICT (creator_id, platform, recorded_at) DO NOTHING;

DROP TABLE public.platform_follower_snapshots;
