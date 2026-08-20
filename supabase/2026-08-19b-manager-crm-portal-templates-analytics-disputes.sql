-- 2026-08-19b-manager-crm-portal-templates-analytics-disputes.sql
--
-- Five manager-facing features (session 2 of 2 on the Manager/Agency
-- tier build; session 1 shipped roster command center, deal pipeline,
-- financials, and sponsor lookup earlier today). All applied live via
-- the Supabase MCP apply_migration tool; this file is the git record.
--
-- 1. CREATOR CRM: manager_creator_notes -- rate card + private notes are
--    the only genuinely new data here (bio/niche/availability already
--    live on creators; past sponsors/contracts are derived from
--    contracts). fn_manager_creator_profile() bundles all of it into one
--    call so the CRM detail panel isn't N queries.
--
-- 2. SPONSOR PORTAL: manager_portal_links (token-based share links, no
--    login) + fn_manager_portal_view(), callable by `anon` since the
--    portal itself is unauthenticated -- same shape as fn_get_public_profile
--    backing p.html. Deliberately excludes dollar figures and any
--    non-selected roster members: this is meant for a brand contact who
--    may not even have a Kitscore account, not a scoped-down login.
--
-- 3. REMINDERS & TEMPLATES: manager_message_templates (real CRUD) +
--    fn_manager_reminders() (computed, not stored -- surfaces overdue/
--    upcoming deliverables, pending approvals, and unbilled/unpaid
--    manager invoices live from existing tables). Deliberately NOT an
--    email-sending cron: cron-evidence-nudges.js's own header notes this
--    codebase moved off nudge emails to in-app surfacing as of July
--    2026. Same call here, in-app only.
--
-- 4. ROSTER ANALYTICS: fn_manager_roster_analytics() (by creator) and
--    fn_manager_sponsor_analytics() (by sponsor). "By campaign" reuses
--    fn_manager_deal_financials(), already shipped today -- no new RPC
--    for that slice, just a different table view client-side, to avoid
--    a second read model over the same rows. "Engagement rate" from the
--    spec is intentionally not fabricated as a new metric: no per-deal
--    engagement figure exists anywhere in this schema. trust_score and
--    reliability_score (both real, already computed) stand in for it.
--
-- 5. DISPUTE & ISSUE LOG: manager_issue_log -- a manager-owned tracking
--    log, deliberately separate from contracts.disputed_at (the formal
--    dispute flow). Managers aren't a party to a contract (creator_id/
--    sponsor_id only), so they can't raise a real dispute themselves --
--    contracts.html's "Report a problem" is creator/sponsor-only. This
--    is scratch space for a manager to log and track an issue with a
--    sponsor and optionally link it to the contract, same non-verified,
--    no-escrow-machinery spirit as deal_flow_entries (2026-08-16c).

-- ============================================================
-- 1. Creator CRM
-- ============================================================
CREATE TABLE manager_creator_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  rate_sponsored_post_cents integer,
  rate_story_cents integer,
  rate_video_cents integer,
  rate_notes text,
  private_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(manager_id, creator_id)
);

CREATE INDEX idx_manager_creator_notes_manager ON manager_creator_notes(manager_id);

ALTER TABLE manager_creator_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers manage their own creator notes" ON manager_creator_notes
  FOR ALL
  USING (manager_id = fn_effective_manager_id())
  WITH CHECK (
    manager_id = fn_effective_manager_id()
    AND fn_is_active_manager_for(creator_id)
  );

CREATE POLICY "admins manage all creator notes" ON manager_creator_notes
  FOR ALL
  USING (fn_is_admin());

CREATE TRIGGER trg_manager_creator_notes_updated_at
  BEFORE UPDATE ON manager_creator_notes
  FOR EACH ROW EXECUTE FUNCTION fn_manager_deal_pipeline_touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON manager_creator_notes TO authenticated;

CREATE OR REPLACE FUNCTION fn_manager_creator_profile(p_creator_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT fn_is_active_manager_for(p_creator_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT jsonb_build_object(
    'creator', (
      SELECT jsonb_build_object(
        'id', c.id, 'display_name', p.display_name, 'bio', c.bio, 'niche', c.niche,
        'location', c.location, 'trust_score', c.trust_score, 'reliability_score', c.reliability_score,
        'availability_status', c.availability_status, 'availability_note', c.availability_note,
        'availability_until', c.availability_until, 'avatar_url', c.avatar_url, 'slug', c.slug
      )
      FROM creators c JOIN profiles p ON p.id = c.id WHERE c.id = p_creator_id
    ),
    'notes', (
      SELECT jsonb_build_object(
        'rate_sponsored_post_cents', n.rate_sponsored_post_cents, 'rate_story_cents', n.rate_story_cents,
        'rate_video_cents', n.rate_video_cents, 'rate_notes', n.rate_notes, 'private_notes', n.private_notes
      )
      FROM manager_creator_notes n
      WHERE n.creator_id = p_creator_id AND n.manager_id = fn_effective_manager_id()
    ),
    'past_sponsors', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'company_name', s.company_name, 'deals_count', x.deals_count, 'total_cents', x.total_cents
      ) ORDER BY x.deals_count DESC), '[]'::jsonb)
      FROM (
        SELECT sponsor_id, count(*) AS deals_count, sum(COALESCE(escrow_amount_cents, 0)) AS total_cents
        FROM contracts WHERE creator_id = p_creator_id AND status = 'fully_signed'
        GROUP BY sponsor_id
      ) x
      JOIN sponsors s ON s.id = x.sponsor_id
    ),
    'contracts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', ct.id, 'title', ct.title, 'sponsor_name', s.company_name, 'status', ct.status,
        'escrow_status', ct.escrow_status, 'escrow_amount_cents', ct.escrow_amount_cents,
        'created_at', ct.created_at, 'released_at', ct.released_at
      ) ORDER BY ct.created_at DESC), '[]'::jsonb)
      FROM contracts ct JOIN sponsors s ON s.id = ct.sponsor_id
      WHERE ct.creator_id = p_creator_id
      LIMIT 25
    ),
    'upcoming_deliverables', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'contract_id', ct.id, 'contract_title', ct.title, 'description', cdi.description,
        'due_date', cdi.due_date, 'content_status', cdi.content_status
      ) ORDER BY cdi.due_date ASC NULLS LAST), '[]'::jsonb)
      FROM contract_deliverable_items cdi JOIN contracts ct ON ct.id = cdi.contract_id
      WHERE ct.creator_id = p_creator_id AND ct.status = 'fully_signed' AND cdi.completed_at IS NULL
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_manager_creator_profile(uuid) TO authenticated;

-- ============================================================
-- 2. Sponsor-facing portal
-- ============================================================
CREATE TABLE manager_portal_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  label text NOT NULL,
  creator_ids uuid[] NOT NULL,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX idx_manager_portal_links_manager ON manager_portal_links(manager_id);
CREATE INDEX idx_manager_portal_links_token ON manager_portal_links(token);

ALTER TABLE manager_portal_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers manage their own portal links" ON manager_portal_links
  FOR ALL
  USING (manager_id = fn_effective_manager_id())
  WITH CHECK (
    manager_id = fn_effective_manager_id()
    AND array_length(creator_ids, 1) > 0
    AND NOT EXISTS (SELECT 1 FROM unnest(creator_ids) cid WHERE NOT fn_is_active_manager_for(cid))
  );

CREATE POLICY "admins manage all portal links" ON manager_portal_links
  FOR ALL
  USING (fn_is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON manager_portal_links TO authenticated;

-- Public, unauthenticated read -- same trust model as fn_get_public_profile
-- backing p.html: a random 48-char token stands in for auth, revocable
-- any time by the manager. No compensation figures, no roster members
-- outside the ones explicitly selected into this link.
CREATE OR REPLACE FUNCTION fn_manager_portal_view(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_link manager_portal_links;
  v_result jsonb;
BEGIN
  SELECT * INTO v_link FROM manager_portal_links WHERE token = p_token AND revoked_at IS NULL;
  IF v_link.id IS NULL THEN
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

GRANT EXECUTE ON FUNCTION fn_manager_portal_view(text) TO anon, authenticated;

-- ============================================================
-- 3. Automated reminders & templates
-- ============================================================
CREATE TABLE manager_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category = ANY (ARRAY[
    'outreach'::text, 'revision_request'::text, 'late_payment'::text,
    'deadline_reminder'::text, 'approval_request'::text, 'other'::text
  ])),
  name text NOT NULL,
  subject text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_manager_message_templates_manager ON manager_message_templates(manager_id);

ALTER TABLE manager_message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers manage their own templates" ON manager_message_templates
  FOR ALL
  USING (manager_id = fn_effective_manager_id())
  WITH CHECK (manager_id = fn_effective_manager_id());

CREATE POLICY "admins manage all templates" ON manager_message_templates
  FOR ALL
  USING (fn_is_admin());

CREATE TRIGGER trg_manager_message_templates_updated_at
  BEFORE UPDATE ON manager_message_templates
  FOR EACH ROW EXECUTE FUNCTION fn_manager_deal_pipeline_touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON manager_message_templates TO authenticated;

-- Computed, not stored -- see header note on why this isn't email cron.
CREATE OR REPLACE FUNCTION fn_manager_reminders()
RETURNS TABLE(
  reminder_type text,
  severity text,
  creator_id uuid,
  creator_name text,
  detail text,
  due_date date,
  contract_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Overdue / upcoming deliverables (within 14 days)
  SELECT
    'deliverable'::text, CASE WHEN cdi.due_date < current_date THEN 'overdue' ELSE 'upcoming' END,
    ct.creator_id, p.display_name, cdi.description, cdi.due_date, ct.id
  FROM contract_deliverable_items cdi
  JOIN contracts ct ON ct.id = cdi.contract_id
  JOIN profiles p ON p.id = ct.creator_id
  WHERE ct.status = 'fully_signed' AND fn_is_active_manager_for(ct.creator_id)
    AND cdi.completed_at IS NULL AND cdi.due_date IS NOT NULL
    AND cdi.due_date < current_date + interval '14 days'

  UNION ALL

  -- Deliverables submitted and awaiting sponsor approval
  SELECT
    'approval'::text, 'pending'::text,
    ct.creator_id, p.display_name, cdi.description, cdi.content_submitted_at::date, ct.id
  FROM contract_deliverable_items cdi
  JOIN contracts ct ON ct.id = cdi.contract_id
  JOIN profiles p ON p.id = ct.creator_id
  WHERE ct.status = 'fully_signed' AND fn_is_active_manager_for(ct.creator_id)
    AND cdi.requires_approval = true AND cdi.content_status = 'submitted' AND cdi.content_approved_at IS NULL

  UNION ALL

  -- Released escrow the manager hasn't invoiced their commission on yet
  SELECT
    'invoice'::text, 'action_needed'::text,
    ct.creator_id, p.display_name, 'Commission not yet invoiced on "' || ct.title || '"', ct.released_at::date, ct.id
  FROM contracts ct
  JOIN profiles p ON p.id = ct.creator_id
  LEFT JOIN manager_deal_financials mdf ON mdf.contract_id = ct.id
  WHERE ct.status = 'fully_signed' AND fn_is_active_manager_for(ct.creator_id)
    AND ct.released_at IS NOT NULL AND COALESCE(mdf.invoice_status, 'not_invoiced') = 'not_invoiced'

  UNION ALL

  -- Invoiced but unpaid for 14+ days
  SELECT
    'payment'::text, 'overdue'::text,
    ct.creator_id, p.display_name, 'Commission invoiced but unpaid on "' || ct.title || '"', mdf.invoice_sent_at::date, ct.id
  FROM manager_deal_financials mdf
  JOIN contracts ct ON ct.id = mdf.contract_id
  JOIN profiles p ON p.id = ct.creator_id
  WHERE fn_is_active_manager_for(ct.creator_id)
    AND mdf.invoice_status = 'invoiced' AND mdf.invoice_paid_at IS NULL
    AND mdf.invoice_sent_at < now() - interval '14 days'

  ORDER BY 6 NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION fn_manager_reminders() TO authenticated;

-- ============================================================
-- 4. Roster performance analytics
-- ============================================================
CREATE OR REPLACE FUNCTION fn_manager_roster_analytics()
RETURNS TABLE(
  creator_id uuid,
  creator_name text,
  verified_deals integer,
  total_revenue_cents bigint,
  on_time_rate numeric,
  repeat_bookings integer,
  trust_score numeric,
  reliability_score numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    mcl.creator_id,
    p.display_name,
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
    cr.trust_score,
    cr.reliability_score
  FROM manager_creator_links mcl
  JOIN profiles p ON p.id = mcl.creator_id
  JOIN creators cr ON cr.id = mcl.creator_id
  WHERE mcl.manager_id = fn_effective_manager_id() AND mcl.status = 'active'
  ORDER BY 4 DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION fn_manager_roster_analytics() TO authenticated;

CREATE OR REPLACE FUNCTION fn_manager_sponsor_analytics()
RETURNS TABLE(
  sponsor_id uuid,
  sponsor_name text,
  deals_count integer,
  total_revenue_cents bigint,
  creators_worked_with integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    s.id, s.company_name,
    count(*)::integer,
    sum(COALESCE(ct.escrow_amount_cents, 0)),
    count(DISTINCT ct.creator_id)::integer
  FROM contracts ct
  JOIN sponsors s ON s.id = ct.sponsor_id
  WHERE ct.status = 'fully_signed' AND fn_is_active_manager_for(ct.creator_id)
  GROUP BY s.id, s.company_name
  ORDER BY 4 DESC;
$$;

GRANT EXECUTE ON FUNCTION fn_manager_sponsor_analytics() TO authenticated;

-- ============================================================
-- 5. Dispute & issue management log
-- ============================================================
CREATE TABLE manager_issue_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  contract_id uuid REFERENCES contracts(id) ON DELETE SET NULL,
  sponsor_name text NOT NULL,
  issue_type text NOT NULL CHECK (issue_type = ANY (ARRAY[
    'late_payment'::text, 'excessive_revisions'::text, 'missed_deadline'::text,
    'communication'::text, 'scope_dispute'::text, 'other'::text
  ])),
  description text NOT NULL,
  evidence_urls text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status = ANY (ARRAY['open'::text, 'investigating'::text, 'resolved'::text, 'escalated'::text])),
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX idx_manager_issue_log_manager ON manager_issue_log(manager_id);

ALTER TABLE manager_issue_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers manage their own issue log" ON manager_issue_log
  FOR ALL
  USING (manager_id = fn_effective_manager_id())
  WITH CHECK (
    manager_id = fn_effective_manager_id()
    AND fn_is_active_manager_for(creator_id)
  );

CREATE POLICY "admins manage all issue logs" ON manager_issue_log
  FOR ALL
  USING (fn_is_admin());

CREATE TRIGGER trg_manager_issue_log_updated_at
  BEFORE UPDATE ON manager_issue_log
  FOR EACH ROW EXECUTE FUNCTION fn_manager_deal_pipeline_touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON manager_issue_log TO authenticated;
