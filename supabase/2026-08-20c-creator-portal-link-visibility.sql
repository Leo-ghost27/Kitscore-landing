-- 2026-08-20c-creator-portal-link-visibility.sql
--
-- Minimum-viable creator visibility into Sponsor Portal links. Previously
-- a creator had no way to know their profile/campaigns/deliverables were
-- included in a manager's public, no-login portal link -- nothing in the
-- creator UI referenced manager_portal_links at all. manager_portal_links
-- RLS intentionally has no creator-read policy (a creator shouldn't be
-- able to read the token, or see which other creators were bundled into
-- the same link), so this is a narrow SECURITY DEFINER count function
-- scoped to the caller's own auth.uid() rather than a table-level grant.
-- Applied live via the Supabase MCP apply_migration tool; this file is
-- the git record.

CREATE OR REPLACE FUNCTION fn_creator_active_portal_link_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT count(*)::integer
  FROM manager_portal_links
  WHERE auth.uid() = ANY(creator_ids)
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now());
$$;

GRANT EXECUTE ON FUNCTION fn_creator_active_portal_link_count() TO authenticated;
