-- 2026-08-20b-manager-agency-tier-server-side-enforcement.sql
--
-- The Agency-vs-Manager split was, for 4 of its 6 UI-hidden features, only
-- a hidden tab -- the RPCs and tables behind them didn't check
-- manager.plan at all. Anyone calling fn_manager_roster_analytics() or
-- fn_manager_deal_financials() directly (open dev tools, call the RPC)
-- got full Agency-tier data on a Manager account. Fine pre-launch; a real
-- revenue leak once billing is live -- which it's about to be.
--
-- Two features already had this right and are untouched here:
--   - fn_manager_agency_rate_benchmark: already checks plan = 'agency'
--   - Branding (document-evekit.js): already checks plan === 'agency'
--     server-side before applying any logo/agency name to a Verified
--     Media Kit
-- Two more (5-creator roster cap, staff invites) were already enforced at
-- the RLS/table level, not just hidden -- also untouched.
--
-- Fixed here: Finances, Sponsors, Analytics (roster + sponsor), and
-- Sponsor Portal (both creating a link and an already-created link
-- continuing to resolve after a plan downgrade).

CREATE OR REPLACE FUNCTION fn_manager_is_agency()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT plan = 'agency' FROM managers WHERE id = fn_effective_manager_id()), false);
$$;

GRANT EXECUTE ON FUNCTION fn_manager_is_agency() TO authenticated;

-- ── Finances ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_manager_deal_financials()
RETURNS TABLE(
  contract_id uuid, creator_id uuid, creator_name text, sponsor_name text, title text,
  gross_fee_cents integer, escrow_status text, commission_pct numeric, commission_cents bigint,
  expenses_cents integer, creator_payable_cents bigint, invoice_status text,
  invoice_sent_at timestamptz, invoice_paid_at timestamptz, released_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT fn_manager_is_agency() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Agency plan required';
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.creator_id, p.display_name, s.company_name, c.title,
    c.escrow_amount_cents, c.escrow_status::text,
    COALESCE(mdf.commission_pct, 20),
    ROUND(COALESCE(c.escrow_amount_cents, 0) * COALESCE(mdf.commission_pct, 20) / 100.0),
    COALESCE(mdf.expenses_cents, 0),
    COALESCE(c.escrow_amount_cents, 0)
      - ROUND(COALESCE(c.escrow_amount_cents, 0) * COALESCE(mdf.commission_pct, 20) / 100.0)
      - COALESCE(mdf.expenses_cents, 0),
    COALESCE(mdf.invoice_status, 'not_invoiced'),
    mdf.invoice_sent_at, mdf.invoice_paid_at, c.released_at, c.created_at
  FROM contracts c
  JOIN profiles p ON p.id = c.creator_id
  JOIN sponsors s ON s.id = c.sponsor_id
  LEFT JOIN manager_deal_financials mdf ON mdf.contract_id = c.id
  WHERE fn_is_active_manager_for(c.creator_id)
    AND c.status = 'fully_signed';
END;
$$;

-- Direct table writes (agency.html's updateFinancials upserts straight to
-- the table, not through an RPC) need the same gate at the RLS level.
DROP POLICY "managers manage their own deal financials" ON manager_deal_financials;
CREATE POLICY "managers manage their own deal financials" ON manager_deal_financials
  FOR ALL
  USING (manager_id = fn_effective_manager_id() AND fn_manager_is_agency())
  WITH CHECK (
    manager_id = fn_effective_manager_id()
    AND fn_manager_is_agency()
    AND EXISTS (SELECT 1 FROM contracts c WHERE c.id = contract_id AND fn_is_active_manager_for(c.creator_id))
  );

-- ── Sponsors ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_manager_sponsor_lookup(p_query text DEFAULT NULL)
RETURNS TABLE(
  sponsor_id uuid, company_name text, plan text, account_active boolean, restricted boolean,
  restriction_reason text, reliability_score numeric, payment_reliability text, campaigns_completed integer,
  sample_size integer, avg_rating numeric, paid_on_time_count integer, paid_late_count integer,
  ghosted_count integer, never_booked_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT fn_manager_is_agency() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Agency plan required';
  END IF;

  RETURN QUERY
  SELECT
    s.id, s.company_name, s.plan::text,
    (s.subscription_status = 'active' AND s.restricted_at IS NULL),
    (s.restricted_at IS NOT NULL), s.restriction_reason,
    s.reliability_score, s.payment_reliability, s.campaigns_completed,
    rel.sample_size, rel.avg_rating, rel.paid_on_time_count, rel.paid_late_count,
    rel.ghosted_count, rel.never_booked_count
  FROM sponsors s
  LEFT JOIN LATERAL fn_sponsor_reliability(s.id) rel ON true
  WHERE s.is_test = false
    AND (p_query IS NULL OR p_query = '' OR s.company_name ILIKE '%' || p_query || '%')
  ORDER BY s.company_name ASC
  LIMIT 25;
END;
$$;

-- ── Analytics ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_manager_roster_analytics()
RETURNS TABLE(
  creator_id uuid, creator_name text, verified_deals integer, total_revenue_cents bigint,
  on_time_rate numeric, repeat_bookings integer, trust_score numeric, reliability_score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT fn_manager_is_agency() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Agency plan required';
  END IF;

  RETURN QUERY
  SELECT
    mcl.creator_id, p.display_name,
    COALESCE((SELECT count(*)::integer FROM contracts c WHERE c.creator_id = mcl.creator_id AND c.status = 'fully_signed'), 0),
    COALESCE((SELECT sum(escrow_amount_cents) FROM contracts c WHERE c.creator_id = mcl.creator_id AND c.status = 'fully_signed'), 0),
    (
      SELECT CASE WHEN count(*) = 0 THEN NULL ELSE round(100.0 * count(*) FILTER (WHERE cdi.completed_at::date <= cdi.due_date) / count(*), 1) END
      FROM contract_deliverable_items cdi JOIN contracts c ON c.id = cdi.contract_id
      WHERE c.creator_id = mcl.creator_id AND cdi.completed_at IS NOT NULL AND cdi.due_date IS NOT NULL
    ),
    COALESCE((
      SELECT count(*)::integer FROM (
        SELECT sponsor_id FROM contracts WHERE creator_id = mcl.creator_id AND status = 'fully_signed'
        GROUP BY sponsor_id HAVING count(*) > 1
      ) rb
    ), 0),
    cr.trust_score, cr.reliability_score
  FROM manager_creator_links mcl
  JOIN profiles p ON p.id = mcl.creator_id
  JOIN creators cr ON cr.id = mcl.creator_id
  WHERE mcl.manager_id = fn_effective_manager_id() AND mcl.status = 'active'
  ORDER BY 4 DESC NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION fn_manager_sponsor_analytics()
RETURNS TABLE(sponsor_id uuid, sponsor_name text, deals_count integer, total_revenue_cents bigint, creators_worked_with integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT fn_manager_is_agency() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Agency plan required';
  END IF;

  RETURN QUERY
  SELECT
    s.id, s.company_name, count(*)::integer,
    sum(COALESCE(ct.escrow_amount_cents, 0)), count(DISTINCT ct.creator_id)::integer
  FROM contracts ct
  JOIN sponsors s ON s.id = ct.sponsor_id
  WHERE ct.status = 'fully_signed' AND fn_is_active_manager_for(ct.creator_id)
  GROUP BY s.id, s.company_name
  ORDER BY 4 DESC;
END;
$$;

-- ── Sponsor Portal ──────────────────────────────────────────────────────
-- Creating a link: direct table write, needs the RLS gate.
DROP POLICY "managers manage their own portal links" ON manager_portal_links;
CREATE POLICY "managers manage their own portal links" ON manager_portal_links
  FOR ALL
  USING (manager_id = fn_effective_manager_id())
  WITH CHECK (
    manager_id = fn_effective_manager_id()
    AND fn_manager_is_agency()
    AND array_length(creator_ids, 1) > 0
    AND NOT EXISTS (SELECT 1 FROM unnest(creator_ids) cid WHERE NOT fn_is_active_manager_for(cid))
  );

-- An already-created link is fetched by an unauthenticated sponsor via
-- token (fn_manager_portal_view has no auth check by design -- that's how
-- an external sponsor views it without a Kitscore login). If the manager
-- downgrades from Agency back to Manager afterward, the link should stop
-- resolving until they upgrade again, matching how branding already
-- re-checks plan at render time rather than baking it in at creation.
--
-- NOTE: a parallel session added expires_at + an expiry check to this same
-- function around the same time (2026-08-20b-manager-portal-links-expiry.sql).
-- The version below is the reconciled one with both checks -- see
-- 2026-08-20-followup-portal-view-merge.sql for that specific fix's history.
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
