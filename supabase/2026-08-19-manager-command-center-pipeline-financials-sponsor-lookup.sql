-- 2026-08-19-manager-command-center-pipeline-financials-sponsor-lookup.sql
--
-- Four manager-facing features, requested as a set for managers running a
-- ~5-creator roster. Applied live via the Supabase MCP apply_migration
-- tool; this file is the git record of that change.
--
-- 1. ROSTER COMMAND CENTER: fn_manager_roster_command_center() -- one RPC
--    call replacing the N+1 Promise.all loop agency.html's roster tab used
--    to do (one count query per creator, per stat). Adds next deadline,
--    overdue count, and revenue-this-month, none of which existed before.
--
-- 2. DEAL PIPELINE (KANBAN): manager_deal_pipeline -- a manager-owned CRM
--    table for the pre-contract funnel (lead through negotiation) that
--    Kitscore's contracts table doesn't model at all (contracts only ever
--    exist from "contract pending" onward). Deliberately similar in spirit
--    to creators' own deal_flow_entries (2026-08-16c) but manager-scoped,
--    roster-validated, and with the fuller 9-stage funnel a manager asked
--    for, including stages that map onto real contract states once a deal
--    is formalized (contract_id is nullable and gets filled in then).
--
-- 3. REVENUE SPLIT: manager_deal_financials -- one row per contract a
--    manager wants to track commission/expenses/invoicing on. Deliberately
--    NOT columns on contracts itself: contracts is shared with sponsors
--    and creators who have no reason to see a manager's commission rate,
--    and plenty of contracts (unmanaged creators) will never have one.
--    Payment status intentionally reuses contracts.escrow_status rather
--    than duplicating it -- invoice_status here tracks a separate,
--    manager-owned concept (has the manager actually invoiced/been paid
--    their commission), not a restatement of escrow state.
--
-- 4. SPONSOR RISK LOOKUP: fn_manager_sponsor_lookup() -- managers have had
--    zero visibility into sponsor reliability before this. Creators get
--    this today via fn_sponsor_reliability() surfaced in briefs.html, but
--    briefs.html explicitly locks managers out ("Briefs are available to
--    creator and sponsor accounts."). This reuses fn_sponsor_reliability()
--    rather than duplicating its logic.
--
--    NOTE ON SCOPE: the requested spec called this a "Kitscore Verified
--    badge." No such verification program exists for sponsors anywhere in
--    this codebase today -- "verified" elsewhere in the app always means a
--    creator's OAuth-connected platform or a verified campaign, never a
--    sponsor identity check. Badging sponsors "Kitscore Verified" would
--    claim a review process that doesn't exist. What's shown instead is
--    real signal that does exist: account standing (active vs.
--    admin-restricted) and reliability built from actual creator ratings
--    and reports, via the same fn_sponsor_reliability() creators already
--    see. Flagged here rather than silently reinterpreted.

-- ============================================================
-- 1. Roster command center
-- ============================================================
CREATE OR REPLACE FUNCTION fn_manager_roster_command_center()
RETURNS TABLE(
  creator_id uuid,
  creator_name text,
  niche text,
  trust_score numeric,
  active_deals integer,
  pending_briefs integer,
  next_deadline date,
  overdue_count integer,
  revenue_this_month_cents bigint,
  linked_since timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    mcl.creator_id,
    p.display_name,
    cr.niche,
    cr.trust_score,
    COALESCE((
      SELECT count(*)::integer FROM contracts c
      WHERE c.creator_id = mcl.creator_id AND c.status = 'fully_signed'
    ), 0),
    COALESCE((
      SELECT count(*)::integer FROM brief_applications ba
      WHERE ba.creator_id = mcl.creator_id AND ba.status = 'pending'
    ), 0),
    (
      SELECT min(cdi.due_date) FROM contract_deliverable_items cdi
      JOIN contracts c ON c.id = cdi.contract_id
      WHERE c.creator_id = mcl.creator_id AND c.status = 'fully_signed'
        AND cdi.completed_at IS NULL AND cdi.due_date IS NOT NULL
    ),
    COALESCE((
      SELECT count(*)::integer FROM contract_deliverable_items cdi
      JOIN contracts c ON c.id = cdi.contract_id
      WHERE c.creator_id = mcl.creator_id AND c.status = 'fully_signed'
        AND cdi.completed_at IS NULL AND cdi.due_date IS NOT NULL
        AND cdi.due_date < current_date
    ), 0),
    COALESCE((
      SELECT sum(c.escrow_released_cents) FROM contracts c
      WHERE c.creator_id = mcl.creator_id
        AND c.released_at >= date_trunc('month', now())
    ), 0),
    mcl.created_at
  FROM manager_creator_links mcl
  JOIN profiles p ON p.id = mcl.creator_id
  JOIN creators cr ON cr.id = mcl.creator_id
  WHERE mcl.manager_id = fn_effective_manager_id()
    AND mcl.status = 'active'
  ORDER BY p.display_name ASC;
$$;

GRANT EXECUTE ON FUNCTION fn_manager_roster_command_center() TO authenticated;

-- ============================================================
-- 2. Deal pipeline (Kanban)
-- ============================================================
CREATE TABLE manager_deal_pipeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  brand_name text NOT NULL,
  contact_name text,
  contact_email text,
  fee_cents integer,
  stage text NOT NULL DEFAULT 'lead' CHECK (stage = ANY (ARRAY[
    'lead'::text, 'outreach_sent'::text, 'negotiating'::text,
    'contract_pending'::text, 'in_production'::text, 'awaiting_approval'::text,
    'published'::text, 'invoiced'::text, 'paid'::text
  ])),
  next_action text,
  deadline date,
  contract_id uuid REFERENCES contracts(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_manager_deal_pipeline_manager ON manager_deal_pipeline(manager_id);
CREATE INDEX idx_manager_deal_pipeline_creator ON manager_deal_pipeline(creator_id);

ALTER TABLE manager_deal_pipeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers manage their own pipeline entries" ON manager_deal_pipeline
  FOR ALL
  USING (manager_id = fn_effective_manager_id())
  WITH CHECK (
    manager_id = fn_effective_manager_id()
    AND fn_is_active_manager_for(creator_id)
  );

CREATE POLICY "admins manage all pipeline entries" ON manager_deal_pipeline
  FOR ALL
  USING (fn_is_admin());

CREATE OR REPLACE FUNCTION fn_manager_deal_pipeline_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE TRIGGER trg_manager_deal_pipeline_updated_at
  BEFORE UPDATE ON manager_deal_pipeline
  FOR EACH ROW EXECUTE FUNCTION fn_manager_deal_pipeline_touch_updated_at();

-- Table-level GRANT before RLS is ever evaluated -- learned from
-- deal_flow_entries (2026-08-16c) shipping without this the first time.
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON manager_deal_pipeline TO authenticated;

-- ============================================================
-- 3. Manager-to-creator split & revenue tracking
-- ============================================================
CREATE TABLE manager_deal_financials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE CASCADE,
  manager_id uuid NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  commission_pct numeric(5,2) NOT NULL DEFAULT 20 CHECK (commission_pct >= 0 AND commission_pct <= 100),
  expenses_cents integer NOT NULL DEFAULT 0 CHECK (expenses_cents >= 0),
  invoice_status text NOT NULL DEFAULT 'not_invoiced' CHECK (invoice_status = ANY (ARRAY['not_invoiced'::text, 'invoiced'::text, 'paid'::text])),
  invoice_sent_at timestamptz,
  invoice_paid_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_manager_deal_financials_manager ON manager_deal_financials(manager_id);

ALTER TABLE manager_deal_financials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers manage their own deal financials" ON manager_deal_financials
  FOR ALL
  USING (manager_id = fn_effective_manager_id())
  WITH CHECK (
    manager_id = fn_effective_manager_id()
    AND EXISTS (SELECT 1 FROM contracts c WHERE c.id = contract_id AND fn_is_active_manager_for(c.creator_id))
  );

CREATE POLICY "admins manage all deal financials" ON manager_deal_financials
  FOR ALL
  USING (fn_is_admin());

CREATE TRIGGER trg_manager_deal_financials_updated_at
  BEFORE UPDATE ON manager_deal_financials
  FOR EACH ROW EXECUTE FUNCTION fn_manager_deal_pipeline_touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON manager_deal_financials TO authenticated;

-- Read model: every fully-signed contract on the manager's roster, left
-- joined to financials so a deal shows up (with sane defaults) even
-- before the manager has set a commission rate on it.
CREATE OR REPLACE FUNCTION fn_manager_deal_financials()
RETURNS TABLE(
  contract_id uuid,
  creator_id uuid,
  creator_name text,
  sponsor_name text,
  title text,
  gross_fee_cents integer,
  escrow_status text,
  commission_pct numeric,
  commission_cents bigint,
  expenses_cents integer,
  creator_payable_cents bigint,
  invoice_status text,
  invoice_sent_at timestamptz,
  invoice_paid_at timestamptz,
  released_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    c.id,
    c.creator_id,
    p.display_name,
    s.company_name,
    c.title,
    c.escrow_amount_cents,
    c.escrow_status::text,
    COALESCE(mdf.commission_pct, 20),
    ROUND(COALESCE(c.escrow_amount_cents, 0) * COALESCE(mdf.commission_pct, 20) / 100.0),
    COALESCE(mdf.expenses_cents, 0),
    COALESCE(c.escrow_amount_cents, 0)
      - ROUND(COALESCE(c.escrow_amount_cents, 0) * COALESCE(mdf.commission_pct, 20) / 100.0)
      - COALESCE(mdf.expenses_cents, 0),
    COALESCE(mdf.invoice_status, 'not_invoiced'),
    mdf.invoice_sent_at,
    mdf.invoice_paid_at,
    c.released_at,
    c.created_at
  FROM contracts c
  JOIN profiles p ON p.id = c.creator_id
  JOIN sponsors s ON s.id = c.sponsor_id
  LEFT JOIN manager_deal_financials mdf ON mdf.contract_id = c.id
  WHERE fn_is_active_manager_for(c.creator_id)
    AND c.status = 'fully_signed'
  ORDER BY c.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION fn_manager_deal_financials() TO authenticated;

-- ============================================================
-- 4. Sponsor risk & trust lookup (read-only, manager-facing)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_manager_sponsor_lookup(p_query text DEFAULT NULL)
RETURNS TABLE(
  sponsor_id uuid,
  company_name text,
  plan text,
  account_active boolean,
  restricted boolean,
  restriction_reason text,
  reliability_score numeric,
  payment_reliability text,
  campaigns_completed integer,
  sample_size integer,
  avg_rating numeric,
  paid_on_time_count integer,
  paid_late_count integer,
  ghosted_count integer,
  never_booked_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF fn_effective_manager_id() IS NULL AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.company_name,
    s.plan::text,
    (s.subscription_status = 'active' AND s.restricted_at IS NULL),
    (s.restricted_at IS NOT NULL),
    s.restriction_reason,
    s.reliability_score,
    s.payment_reliability,
    s.campaigns_completed,
    rel.sample_size,
    rel.avg_rating,
    rel.paid_on_time_count,
    rel.paid_late_count,
    rel.ghosted_count,
    rel.never_booked_count
  FROM sponsors s
  LEFT JOIN LATERAL fn_sponsor_reliability(s.id) rel ON true
  WHERE s.is_test = false
    AND (p_query IS NULL OR p_query = '' OR s.company_name ILIKE '%' || p_query || '%')
  ORDER BY s.company_name ASC
  LIMIT 25;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_manager_sponsor_lookup(text) TO authenticated;
