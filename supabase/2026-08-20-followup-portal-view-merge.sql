-- 2026-08-20-followup-portal-view-merge.sql
--
-- A parallel session added expires_at + an expiry check to
-- fn_manager_portal_view() (2026-08-20b-manager-portal-links-expiry.sql)
-- at almost the same time this session added an Agency-plan check to the
-- same function (2026-08-20d, CREATE OR REPLACE). Whichever applied last
-- silently overwrote the other's check -- in this case the plan-gate
-- migration landed after the expiry migration and dropped the expiry
-- filter. Caught by re-fetching before push and diffing against the
-- other session's committed SQL; not caught by any test, since neither
-- session had one for this function.
--
-- Applied live via the Supabase MCP apply_migration tool; this file
-- is the git record of that reconciliation.
CREATE OR REPLACE FUNCTION fn_manager_portal_view(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_link manager_portal_links;
  v_plan plan_tier;
  v_result jsonb;
BEGIN
  SELECT * INTO v_link FROM manager_portal_links
    WHERE token = p_token
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now());
  IF v_link.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT plan INTO v_plan FROM managers WHERE id = v_link.manager_id;
  IF v_plan IS DISTINCT FROM 'agency' THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'label', v_link.label,
    'agency_name', m.agency_name,
    'logo_url', m.logo_url,
    'creators', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', c.id, 'display_name', p.display_name, 'avatar_url', c.avatar_url,
        'bio', c.bio, 'niche', c.niche,
        'campaigns', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'title', ct.title, 'sponsor_name', s.company_name, 'status', ct.status,
            'deliverables', (
              SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'description', cdi.description, 'due_date', cdi.due_date,
                'content_status', cdi.content_status, 'completed_at', cdi.completed_at
              ) ORDER BY cdi.sort_order), '[]'::jsonb)
              FROM contract_deliverable_items cdi WHERE cdi.contract_id = ct.id
            )
          ) ORDER BY ct.created_at DESC), '[]'::jsonb)
          FROM contracts ct JOIN sponsors s ON s.id = ct.sponsor_id
          WHERE ct.creator_id = c.id AND ct.status = 'fully_signed'
        )
      )), '[]'::jsonb)
      FROM creators c JOIN profiles p ON p.id = c.id
      WHERE c.id = ANY(v_link.creator_ids)
    )
  ) INTO v_result
  FROM managers m WHERE m.id = v_link.manager_id;

  RETURN v_result;
END;
$$;
