-- 2026-07-31i-creator-watchlist-interest-visibility.sql
--
-- Demand-side transparency for creators: today the watchlists table
-- (sponsor_id, creator_id, created_at) is 100% invisible to the creator
-- being watchlisted -- watchlists_owner_only locks every row to the
-- sponsor who added it (or admin). A creator has real, existing demand
-- signal sitting in the database about them and can't see any of it.
--
-- Gating decision (see chat): the pricing page already sells "Verified
-- Media Kit view analytics -- see how many brands have opened it" as a
-- Pro-only feature (app/pricing-creator.html), but no infrastructure for
-- brand-level identity ever got built -- profile_views is just an
-- anonymous aggregate counter. This RPC finishes that promise rather
-- than making a new gating decision: aggregate COUNT is free for every
-- creator (the "cheap antidote to feeling like a data point" -- knowing
-- *that* sponsors are interested, with zero cost to sponsor privacy),
-- and sponsor IDENTITY (which companies, when) is Pro-only, matching
-- existing plan='pro' gating convention used throughout dashboard.html.
--
-- SECURITY DEFINER so the gating logic lives in one place enforced by
-- the database, not just hidden in the client -- a free-tier creator
-- calling this RPC directly still can't see sponsor identity, unlike if
-- this were done by loosening the RLS policy itself.
--
-- Applied directly to Supabase (project tpcriphrfrrgywycviqv) via the
-- Supabase MCP apply_migration tool on 2026-07-31; this file is the git
-- record of that change per supabase/README.md's practice.

CREATE OR REPLACE FUNCTION public.fn_get_creator_interest(p_creator_id uuid)
RETURNS TABLE(total_count bigint, is_locked boolean, sponsor_id uuid, company_name text, watchlisted_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_plan text;
BEGIN
  IF p_creator_id != fn_current_profile_id() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Not authorized to view this creator''s watchlist interest';
  END IF;

  SELECT plan INTO v_plan FROM creators WHERE id = p_creator_id;

  IF v_plan = 'pro' OR fn_is_admin() THEN
    RETURN QUERY
      SELECT
        (SELECT count(*) FROM watchlists w WHERE w.creator_id = p_creator_id),
        false,
        w.sponsor_id,
        s.company_name,
        w.created_at
      FROM watchlists w
      JOIN sponsors s ON s.id = w.sponsor_id
      WHERE w.creator_id = p_creator_id
      ORDER BY w.created_at DESC;
  ELSE
    RETURN QUERY
      SELECT
        (SELECT count(*) FROM watchlists w WHERE w.creator_id = p_creator_id),
        true,
        NULL::uuid, NULL::text, NULL::timestamptz;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_creator_interest(uuid) TO authenticated;
