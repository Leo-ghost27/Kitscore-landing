-- 2026-08-20e-manager-subscription-enforcement-and-admin-oversight.sql
--
-- CRITICAL FIX, found during a full leak/bug review of the manager/agency
-- surface requested this session. Traces directly to the trial/paywall
-- work earlier today: I gated agency.html and pipeline.html at the PAGE
-- level (managerHasAccess() redirects to a paywall card) but never added
-- the equivalent check to the underlying RPCs and RLS policies. Every
-- single manager RPC -- fn_manager_roster_command_center,
-- fn_manager_payout_ledger, fn_manager_performance_report,
-- fn_manager_trust_score, fn_manager_creator_profile, fn_manager_reminders,
-- fn_manager_audit_trail, fn_manager_linkable_contracts -- and direct table
-- access to manager_creator_notes, manager_issue_log,
-- manager_message_templates, manager_deal_pipeline had zero
-- subscription_status check. Anyone with a free 'manager' row (which is
-- every account, by default, on signup -- no payment gate at creation)
-- could call these directly and get full functionality regardless of
-- whether they'd ever started a trial or paid anything. This is the exact
-- same class of issue flagged externally for the Agency tier earlier
-- today, self-inflicted this time on the Manager tier's own $49 paywall.
--
-- Compounding bug: fn_manager_is_agency() (built to fix the Agency-tier
-- version of this) only checked plan = 'agency', never subscription_status.
-- Combined with the webhook deliberately leaving `plan` alone on
-- cancellation (so a lapsed account keeps its plan label, only
-- subscription_status changes), a manager whose Agency subscription
-- CANCELLED kept full Agency-tier RPC access indefinitely, forever, via
-- direct RPC calls -- the page-level paywall would lock them out of the
-- UI, but not the data.
--
-- Also fixed: the 5-creator roster cap's RLS bypass check used a raw
-- `plan = 'agency'` comparison instead of fn_is_active_agency() (which
-- already correctly checks both plan AND subscription_status = 'active').
-- Same root cause, different table: a cancelled Agency account kept an
-- uncapped roster.
--
-- Also fixed in passing: manager_creator_links_manager_select used
-- fn_current_profile_id() instead of fn_effective_manager_id(), so an
-- agency staff member querying the table directly (as agency.html's
-- loadRoster does) got zero rows -- a real functional bug (staff
-- effectively couldn't see the roster), found while reading the same
-- policy for the security review.

-- ── The master gate ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_manager_has_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT subscription_status IN ('trialing', 'active') FROM managers WHERE id = fn_effective_manager_id()),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION fn_manager_has_access() TO authenticated;

-- fn_manager_is_agency now requires an active/trialing subscription AND
-- the agency plan -- both, not just the plan label. Every RPC and RLS
-- policy that already calls fn_manager_is_agency() (fn_manager_deal_financials,
-- manager_deal_financials RLS, fn_manager_sponsor_lookup,
-- fn_manager_roster_analytics, fn_manager_sponsor_analytics,
-- manager_portal_links RLS, fn_manager_portal_view) inherits this fix
-- automatically via CREATE OR REPLACE -- no need to touch their bodies.
CREATE OR REPLACE FUNCTION fn_manager_is_agency()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT fn_manager_has_access()
    AND COALESCE((SELECT plan = 'agency' FROM managers WHERE id = fn_effective_manager_id()), false);
$$;

-- ── Manager-tier RPCs: add the access gate ─────────────────────────────
CREATE OR REPLACE FUNCTION fn_manager_roster_command_center()
RETURNS TABLE(
  creator_id uuid, creator_name text, niche text, trust_score numeric, active_deals integer,
  pending_briefs integer, next_deadline date, overdue_count integer, revenue_this_month_cents bigint,
  linked_since timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT fn_manager_has_access() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Manager plan required';
  END IF;

  RETURN QUERY
  SELECT
    mcl.creator_id, p.display_name, cr.niche, cr.trust_score,
    COALESCE((SELECT count(*)::integer FROM contracts c WHERE c.creator_id = mcl.creator_id AND c.status = 'fully_signed'), 0),
    COALESCE((SELECT count(*)::integer FROM brief_applications ba WHERE ba.creator_id = mcl.creator_id AND ba.status = 'pending'), 0),
    (
      SELECT min(cdi.due_date) FROM contract_deliverable_items cdi JOIN contracts c ON c.id = cdi.contract_id
      WHERE c.creator_id = mcl.creator_id AND c.status = 'fully_signed' AND cdi.completed_at IS NULL AND cdi.due_date IS NOT NULL
    ),
    COALESCE((
      SELECT count(*)::integer FROM contract_deliverable_items cdi JOIN contracts c ON c.id = cdi.contract_id
      WHERE c.creator_id = mcl.creator_id AND c.status = 'fully_signed' AND cdi.completed_at IS NULL
        AND cdi.due_date IS NOT NULL AND cdi.due_date < current_date
    ), 0),
    COALESCE((SELECT sum(c.escrow_released_cents) FROM contracts c WHERE c.creator_id = mcl.creator_id AND c.released_at >= date_trunc('month', now())), 0),
    mcl.created_at
  FROM manager_creator_links mcl
  JOIN profiles p ON p.id = mcl.creator_id
  JOIN creators cr ON cr.id = mcl.creator_id
  WHERE mcl.manager_id = fn_effective_manager_id() AND mcl.status = 'active'
  ORDER BY p.display_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION fn_manager_payout_ledger()
RETURNS TABLE(
  contract_id uuid, creator_id uuid, creator_name text, sponsor_name text, title text,
  escrow_amount_cents integer, escrow_status text, created_at timestamptz, funded_at timestamptz, released_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT fn_manager_has_access() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Manager plan required';
  END IF;

  RETURN QUERY
  SELECT c.id, c.creator_id, p.display_name, s.company_name, c.title, c.escrow_amount_cents,
    c.escrow_status::text, c.created_at, c.funded_at, c.released_at
  FROM contracts c
  JOIN profiles p ON p.id = c.creator_id
  JOIN sponsors s ON s.id = c.sponsor_id
  WHERE fn_is_active_manager_for(c.creator_id)
  ORDER BY c.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION fn_manager_performance_report()
RETURNS TABLE(
  creator_id uuid, creator_name text, verified_deals integer, total_earned_cents bigint,
  in_progress_deals integer, in_progress_value_cents bigint, linked_since timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT fn_manager_has_access() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Manager plan required';
  END IF;

  RETURN QUERY
  SELECT
    mcl.creator_id, p.display_name,
    COALESCE((SELECT count(*)::integer FROM campaigns camp WHERE camp.creator_id = mcl.creator_id AND camp.status = 'verified'), 0),
    COALESCE((SELECT sum(c.escrow_amount_cents) FROM contracts c WHERE c.creator_id = mcl.creator_id AND c.escrow_status IN ('released','settled')), 0),
    COALESCE((SELECT count(*)::integer FROM contracts c WHERE c.creator_id = mcl.creator_id AND c.status NOT IN ('void') AND c.escrow_status NOT IN ('released','settled','refunded','failed')), 0),
    COALESCE((SELECT sum(c.escrow_amount_cents) FROM contracts c WHERE c.creator_id = mcl.creator_id AND c.status NOT IN ('void') AND c.escrow_status NOT IN ('released','settled','refunded','failed')), 0),
    mcl.created_at
  FROM manager_creator_links mcl
  JOIN profiles p ON p.id = mcl.creator_id
  WHERE mcl.manager_id = fn_effective_manager_id() AND mcl.status = 'active'
  ORDER BY mcl.created_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION fn_manager_trust_score(p_manager_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(score numeric, roster_size integer, avg_creator_trust_score numeric, verified_deals integer, tenure_months numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_manager_id uuid := COALESCE(p_manager_id, fn_effective_manager_id());
  v_roster_size integer; v_avg_trust numeric; v_verified_deals integer;
  v_oldest_link timestamptz; v_tenure_months numeric; v_volume_score numeric; v_tenure_score numeric;
BEGIN
  IF v_manager_id != fn_effective_manager_id() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT fn_manager_has_access() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Manager plan required';
  END IF;

  SELECT count(*), avg(cr.trust_score), min(mcl.created_at)
  INTO v_roster_size, v_avg_trust, v_oldest_link
  FROM manager_creator_links mcl JOIN creators cr ON cr.id = mcl.creator_id
  WHERE mcl.manager_id = v_manager_id AND mcl.status = 'active';

  IF v_roster_size IS NULL OR v_roster_size = 0 THEN
    RETURN QUERY SELECT NULL::numeric, 0, NULL::numeric, 0, NULL::numeric;
    RETURN;
  END IF;

  SELECT count(*) INTO v_verified_deals FROM campaigns camp
  WHERE camp.status = 'verified'
    AND EXISTS (SELECT 1 FROM manager_creator_links mcl WHERE mcl.manager_id = v_manager_id AND mcl.creator_id = camp.creator_id AND mcl.status = 'active');

  v_tenure_months := LEAST(EXTRACT(EPOCH FROM (now() - v_oldest_link)) / (30 * 86400), 12);
  v_volume_score := LEAST(v_verified_deals * 5, 100);
  v_tenure_score := (v_tenure_months / 12) * 100;

  RETURN QUERY SELECT
    ROUND(COALESCE(v_avg_trust, 0) * 0.50 + v_volume_score * 0.35 + v_tenure_score * 0.15, 1),
    v_roster_size, ROUND(v_avg_trust, 1), v_verified_deals, ROUND(v_tenure_months, 1);
END;
$$;

CREATE OR REPLACE FUNCTION fn_manager_creator_profile(p_creator_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT fn_is_active_manager_for(p_creator_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT fn_manager_has_access() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Manager plan required';
  END IF;

  SELECT jsonb_build_object(
    'creator', (SELECT jsonb_build_object('id', c.id, 'display_name', p.display_name, 'bio', c.bio, 'niche', c.niche,
      'location', c.location, 'trust_score', c.trust_score, 'reliability_score', c.reliability_score,
      'availability_status', c.availability_status, 'availability_note', c.availability_note,
      'availability_until', c.availability_until, 'avatar_url', c.avatar_url, 'slug', c.slug)
      FROM creators c JOIN profiles p ON p.id = c.id WHERE c.id = p_creator_id),
    'notes', (SELECT jsonb_build_object('rate_sponsored_post_cents', n.rate_sponsored_post_cents,
      'rate_story_cents', n.rate_story_cents, 'rate_video_cents', n.rate_video_cents,
      'rate_notes', n.rate_notes, 'private_notes', n.private_notes)
      FROM manager_creator_notes n WHERE n.creator_id = p_creator_id AND n.manager_id = fn_effective_manager_id()),
    'past_sponsors', (SELECT COALESCE(jsonb_agg(jsonb_build_object('company_name', s.company_name, 'deals_count', x.deals_count, 'total_cents', x.total_cents) ORDER BY x.deals_count DESC), '[]'::jsonb)
      FROM (SELECT sponsor_id, count(*) AS deals_count, sum(COALESCE(escrow_amount_cents, 0)) AS total_cents FROM contracts WHERE creator_id = p_creator_id AND status = 'fully_signed' GROUP BY sponsor_id) x
      JOIN sponsors s ON s.id = x.sponsor_id),
    'contracts', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', ct.id, 'title', ct.title, 'sponsor_name', s.company_name, 'status', ct.status,
      'escrow_status', ct.escrow_status, 'escrow_amount_cents', ct.escrow_amount_cents, 'created_at', ct.created_at, 'released_at', ct.released_at) ORDER BY ct.created_at DESC), '[]'::jsonb)
      FROM contracts ct JOIN sponsors s ON s.id = ct.sponsor_id WHERE ct.creator_id = p_creator_id LIMIT 25),
    'upcoming_deliverables', (SELECT COALESCE(jsonb_agg(jsonb_build_object('contract_id', ct.id, 'contract_title', ct.title, 'description', cdi.description,
      'due_date', cdi.due_date, 'content_status', cdi.content_status) ORDER BY cdi.due_date ASC NULLS LAST), '[]'::jsonb)
      FROM contract_deliverable_items cdi JOIN contracts ct ON ct.id = cdi.contract_id WHERE ct.creator_id = p_creator_id AND ct.status = 'fully_signed' AND cdi.completed_at IS NULL)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION fn_manager_reminders()
RETURNS TABLE(reminder_type text, severity text, creator_id uuid, creator_name text, detail text, due_date date, contract_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT fn_manager_has_access() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Manager plan required';
  END IF;

  RETURN QUERY
  SELECT 'deliverable'::text, CASE WHEN cdi.due_date < current_date THEN 'overdue' ELSE 'upcoming' END,
    ct.creator_id, p.display_name, cdi.description, cdi.due_date, ct.id
  FROM contract_deliverable_items cdi JOIN contracts ct ON ct.id = cdi.contract_id JOIN profiles p ON p.id = ct.creator_id
  WHERE ct.status = 'fully_signed' AND fn_is_active_manager_for(ct.creator_id)
    AND cdi.completed_at IS NULL AND cdi.due_date IS NOT NULL AND cdi.due_date < current_date + interval '14 days'
  UNION ALL
  SELECT 'approval'::text, 'pending'::text, ct.creator_id, p.display_name, cdi.description, cdi.content_submitted_at::date, ct.id
  FROM contract_deliverable_items cdi JOIN contracts ct ON ct.id = cdi.contract_id JOIN profiles p ON p.id = ct.creator_id
  WHERE ct.status = 'fully_signed' AND fn_is_active_manager_for(ct.creator_id)
    AND cdi.requires_approval = true AND cdi.content_status = 'submitted' AND cdi.content_approved_at IS NULL
  UNION ALL
  -- Invoice reminders reference manager_deal_financials, an Agency-tier
  -- concept (see 2026-08-20d) -- only show these to accounts that can
  -- actually act on them, so a Manager-plan account isn't nudged toward
  -- a workflow it doesn't have access to.
  SELECT 'invoice'::text, 'action_needed'::text, ct.creator_id, p.display_name,
    'Commission not yet invoiced on "' || ct.title || '"', ct.released_at::date, ct.id
  FROM contracts ct JOIN profiles p ON p.id = ct.creator_id LEFT JOIN manager_deal_financials mdf ON mdf.contract_id = ct.id
  WHERE ct.status = 'fully_signed' AND fn_is_active_manager_for(ct.creator_id) AND fn_manager_is_agency()
    AND ct.released_at IS NOT NULL AND COALESCE(mdf.invoice_status, 'not_invoiced') = 'not_invoiced'
  UNION ALL
  SELECT 'payment'::text, 'overdue'::text, ct.creator_id, p.display_name,
    'Commission invoiced but unpaid on "' || ct.title || '"', mdf.invoice_sent_at::date, ct.id
  FROM manager_deal_financials mdf JOIN contracts ct ON ct.id = mdf.contract_id JOIN profiles p ON p.id = ct.creator_id
  WHERE fn_is_active_manager_for(ct.creator_id) AND fn_manager_is_agency()
    AND mdf.invoice_status = 'invoiced' AND mdf.invoice_paid_at IS NULL AND mdf.invoice_sent_at < now() - interval '14 days'
  ORDER BY 6 NULLS LAST;
END;
$$;

CREATE OR REPLACE FUNCTION fn_manager_audit_trail()
RETURNS TABLE(event_date timestamptz, event_type text, actor_name text, subject_name text, detail text, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT fn_manager_has_access() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Manager plan required';
  END IF;

  RETURN QUERY
  SELECT e.uploaded_at, 'Evidence submitted'::text,
    coalesce(actor.display_name, cr.display_name) || (case when e.acted_by is not null then ' (manager)' else '' end),
    cr.display_name, coalesce(e.evidence_type, 'Evidence') || (case when e.platform is not null then ' — ' || e.platform else '' end), e.status::text
  FROM evidence_uploads e JOIN creators c ON c.id = e.creator_id JOIN profiles cr ON cr.id = c.id
  LEFT JOIN profiles actor ON actor.id = e.acted_by
  WHERE fn_is_active_manager_for(e.creator_id)
  UNION ALL
  SELECT ba.created_at, 'Brief application'::text,
    coalesce(actor.display_name, cr.display_name) || (case when ba.acted_by is not null then ' (manager)' else '' end),
    cr.display_name, coalesce(cb.title, 'Brief'), ba.status::text
  FROM brief_applications ba JOIN creators c ON c.id = ba.creator_id JOIN profiles cr ON cr.id = c.id
  LEFT JOIN profiles actor ON actor.id = ba.acted_by LEFT JOIN campaign_briefs cb ON cb.id = ba.brief_id
  WHERE fn_is_active_manager_for(ba.creator_id)
  UNION ALL
  SELECT mcl.created_at, 'Roster link'::text, cr.display_name, 'Manager access'::text, ''::text, 'Linked'::text
  FROM manager_creator_links mcl JOIN creators c ON c.id = mcl.creator_id JOIN profiles cr ON cr.id = c.id
  WHERE fn_is_active_manager_for(mcl.creator_id)
  UNION ALL
  SELECT mcl.revoked_at, 'Roster link'::text, cr.display_name, 'Manager access'::text, ''::text, 'Revoked'::text
  FROM manager_creator_links mcl JOIN creators c ON c.id = mcl.creator_id JOIN profiles cr ON cr.id = c.id
  WHERE mcl.status = 'revoked' AND mcl.revoked_at IS NOT NULL AND mcl.manager_id = fn_effective_manager_id()
  ORDER BY 1 DESC;
END;
$$;

CREATE OR REPLACE FUNCTION fn_manager_linkable_contracts(p_creator_id uuid)
RETURNS TABLE(
  contract_id uuid, title text, status text, escrow_status text, escrow_amount_cents integer,
  deliverable_submitted_at timestamptz, released_at timestamptz, already_linked_to_deal_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT fn_manager_has_access() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Manager plan required';
  END IF;

  RETURN QUERY
  SELECT c.id, c.title, c.status::text, c.escrow_status::text, c.escrow_amount_cents,
    c.deliverable_submitted_at, c.released_at, mdp.id
  FROM contracts c LEFT JOIN manager_deal_pipeline mdp ON mdp.contract_id = c.id
  WHERE c.creator_id = p_creator_id AND fn_is_active_manager_for(c.creator_id) AND c.status != 'void'
  ORDER BY c.created_at DESC;
END;
$$;

-- fn_manager_agency_rate_benchmark had its own inline plan check --
-- switching it to the centralized fn_manager_is_agency() so it also picks
-- up the subscription_status requirement, and stays consistent if the
-- Agency-gate definition changes again later.
CREATE OR REPLACE FUNCTION fn_manager_agency_rate_benchmark()
RETURNS TABLE(niche text, sample_size integer, min_cents integer, median_cents integer, max_cents integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_manager_id uuid := fn_effective_manager_id();
BEGIN
  IF NOT fn_manager_is_agency() AND NOT fn_is_admin() THEN
    RAISE EXCEPTION 'Agency-level rate benchmark requires the Agency plan';
  END IF;

  RETURN QUERY
  SELECT cr.niche, count(*)::integer, min(c.escrow_amount_cents)::integer,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY c.escrow_amount_cents)::integer, max(c.escrow_amount_cents)::integer
  FROM contracts c JOIN creators cr ON cr.id = c.creator_id
  WHERE c.escrow_status IN ('released', 'settled') AND cr.niche IS NOT NULL
    AND EXISTS (SELECT 1 FROM manager_creator_links mcl WHERE mcl.manager_id = v_manager_id AND mcl.creator_id = c.creator_id AND mcl.status = 'active')
  GROUP BY cr.niche HAVING count(*) >= 3;
END;
$$;

-- ── Direct-table RLS: add the access gate ──────────────────────────────
DROP POLICY "managers manage their own creator notes" ON manager_creator_notes;
CREATE POLICY "managers manage their own creator notes" ON manager_creator_notes
  FOR ALL
  USING (manager_id = fn_effective_manager_id() AND fn_manager_has_access())
  WITH CHECK (manager_id = fn_effective_manager_id() AND fn_manager_has_access() AND fn_is_active_manager_for(creator_id));

DROP POLICY "managers manage their own issue log" ON manager_issue_log;
CREATE POLICY "managers manage their own issue log" ON manager_issue_log
  FOR ALL
  USING (manager_id = fn_effective_manager_id() AND fn_manager_has_access())
  WITH CHECK (manager_id = fn_effective_manager_id() AND fn_manager_has_access() AND fn_is_active_manager_for(creator_id));

DROP POLICY "managers manage their own templates" ON manager_message_templates;
CREATE POLICY "managers manage their own templates" ON manager_message_templates
  FOR ALL
  USING (manager_id = fn_effective_manager_id() AND fn_manager_has_access())
  WITH CHECK (manager_id = fn_effective_manager_id() AND fn_manager_has_access());

DROP POLICY "managers manage their own pipeline entries" ON manager_deal_pipeline;
CREATE POLICY "managers manage their own pipeline entries" ON manager_deal_pipeline
  FOR ALL
  USING (manager_id = fn_effective_manager_id() AND fn_manager_has_access())
  WITH CHECK (manager_id = fn_effective_manager_id() AND fn_manager_has_access() AND fn_is_active_manager_for(creator_id));

-- ── Roster-cap bypass: use fn_is_active_agency() (already correct),
-- not a raw plan comparison ────────────────────────────────────────────
DROP POLICY "manager_creator_links_creator_insert" ON manager_creator_links;
CREATE POLICY "manager_creator_links_creator_insert" ON manager_creator_links
  FOR INSERT
  WITH CHECK (
    (creator_id = fn_current_profile_id() OR fn_is_admin())
    AND (
      status <> 'active'
      OR fn_is_active_agency(manager_id)
      OR (SELECT count(*) FROM manager_creator_links mcl2 WHERE mcl2.manager_id = manager_creator_links.manager_id AND mcl2.status = 'active') < 5
    )
  );

DROP POLICY "manager_creator_links_manager_self_insert" ON manager_creator_links;
CREATE POLICY "manager_creator_links_manager_self_insert" ON manager_creator_links
  FOR INSERT
  WITH CHECK (
    manager_id = fn_current_profile_id()
    AND EXISTS (
      SELECT 1 FROM manager_invites mi
      WHERE mi.creator_id = manager_creator_links.creator_id AND mi.expires_at > now()
        AND mi.email = (SELECT p.email FROM profiles p WHERE p.id = fn_current_profile_id())
    )
    AND (
      status <> 'active'
      OR fn_is_active_agency(manager_id)
      OR (SELECT count(*) FROM manager_creator_links mcl2 WHERE mcl2.manager_id = manager_creator_links.manager_id AND mcl2.status = 'active') < 5
    )
  );

-- ── Functional bug fix: staff couldn't see the roster at all ──────────
-- (fn_current_profile_id() is the raw logged-in user; for agency staff
-- that's their own id, never the owner's manager_id the links are stored
-- under. fn_effective_manager_id() resolves staff to their owner.)
DROP POLICY "manager_creator_links_manager_select" ON manager_creator_links;
CREATE POLICY "manager_creator_links_manager_select" ON manager_creator_links
  FOR SELECT
  USING (manager_id = fn_effective_manager_id());
