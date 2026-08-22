-- 2026-08-21b-followup-evaluations-score-components-campaigns-insert.sql
--
-- Continuing the full-schema sweep, following the README guardrail
-- (check INSERT and UPDATE together, grep real client usage first).
--
-- SCORE_COMPONENTS (severe): score_components_write_own let a creator
-- INSERT/UPDATE/DELETE their own component rows (value, weight, status),
-- and trg_recalc_trust_score recomputes creators.trust_score from
-- exactly those columns on every change. Direct backdoor around the
-- trust_score lockdown fixed earlier: even with creators.trust_score
-- itself no longer writable, a creator could fabricate the inputs and
-- let the trigger launder them into whatever score they wanted --
-- and it would survive future legitimate recalculations too. Confirmed
-- via grep: every client page only .select()s this table; the one
-- server-side reader (lib/ai-brief.js) uses the service-role client and
-- only reads. No legitimate write path exists. Replaced the policy with
-- admin-only (same category as disclosure_scans/support_tickets, which
-- were already correctly admin-only).
--
-- EVALUATIONS (severe): evaluations_team_approval let any team member
-- write any column. Two real gaps:
-- 1. "Only your team owner can approve or reject" (app/evaluate.html's
--    reviewEvaluation()) was enforced ONLY by a client-side
--    `if (!isTeamOwner)` check. Fixed via trigger: any team member can
--    still submit for review (approval_status -> 'pending_approval'),
--    only the team owner can actually approve/reject.
-- 2. unlocked/unlocked_at/stripe_payment_id/price_cents (paid-content-
--    unlock fields) were never touched by any real client code --
--    confirmed via grep of every update() call in app/evaluate.html.
--    A team member could have set unlocked = true directly and gotten
--    paid evaluation content for free. Locked to admin/service_role
--    alongside trust_score_at_approval/content_risk_flag/ai_summary/
--    ai_generated_at (also never client-written).
-- 3. evaluations_insert_sponsor turned out to be entirely unused --
--    the real creation path (api/generate-evaluation.js) uses the
--    service-role admin client, bypassing RLS. That left the policy as
--    pure attack surface: a sponsor could INSERT a fully fabricated
--    "paid, approved, verified" evaluation from nothing, since the
--    WITH CHECK only verified sponsor identity, not field values.
--    Removed the policy outright since nothing depends on it.
--
-- CAMPAIGNS INSERT (severe, found by re-checking my own earlier UPDATE-
-- only fix against the guardrail): campaigns_insert_involved's WITH
-- CHECK only verifies creator_id/sponsor_id ownership, and NONE of the
-- validation triggers (fn_validate_campaign_confirmation,
-- fn_campaign_mutual_confirm, rating/endorsement triggers) fire on
-- INSERT -- only BEFORE UPDATE. A party could have inserted a brand-new
-- campaign row already claiming status = 'verified', both parties
-- confirmed, a fabricated verified_at date, or even a pre-set
-- admin_resolved_at. trg_recalc_badge_tier/trg_recalc_confidence_campaigns
-- both fire on "INSERT OR UPDATE OF status", so a fabricated verified
-- insert would have fed straight into real trust-score computation.
-- Confirmed the real insert shape via grep (app/campaigns.html): only
-- creator_id, sponsor_id, name, sponsor_confirmed: true, budget_range,
-- objective are ever set at creation. Added a BEFORE INSERT trigger
-- requiring new rows start at their true default state (pending,
-- creator unconfirmed, nothing verified/disputed/admin-resolved).

DROP POLICY IF EXISTS score_components_write_own ON public.score_components;
CREATE POLICY score_components_admin_write ON public.score_components
  FOR ALL
  USING (fn_is_admin())
  WITH CHECK (fn_is_admin());

CREATE OR REPLACE FUNCTION fn_guard_evaluation_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (SELECT auth.role()) = 'service_role' OR fn_is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.unlocked IS DISTINCT FROM OLD.unlocked
     OR NEW.unlocked_at IS DISTINCT FROM OLD.unlocked_at
     OR NEW.stripe_payment_id IS DISTINCT FROM OLD.stripe_payment_id
     OR NEW.price_cents IS DISTINCT FROM OLD.price_cents
     OR NEW.trust_score_at_approval IS DISTINCT FROM OLD.trust_score_at_approval
     OR NEW.content_risk_flag IS DISTINCT FROM OLD.content_risk_flag
     OR NEW.ai_summary IS DISTINCT FROM OLD.ai_summary
     OR NEW.ai_generated_at IS DISTINCT FROM OLD.ai_generated_at THEN
    RAISE EXCEPTION 'These fields can only be changed by Kitscore''s payment/scoring system';
  END IF;

  IF NEW.approval_status IS DISTINCT FROM OLD.approval_status
     OR NEW.approval_note IS DISTINCT FROM OLD.approval_note
     OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
     OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by THEN
    IF NEW.approval_status = 'pending_approval' AND OLD.approval_status IS DISTINCT FROM 'pending_approval' THEN
      NULL; -- allowed for any team member
    ELSIF NOT EXISTS (SELECT 1 FROM teams WHERE id = NEW.team_id AND owner_id = fn_current_profile_id()) THEN
      RAISE EXCEPTION 'Only your team owner can approve or reject an evaluation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_evaluation_fields ON public.evaluations;
CREATE TRIGGER trg_guard_evaluation_fields
  BEFORE UPDATE ON public.evaluations
  FOR EACH ROW EXECUTE FUNCTION fn_guard_evaluation_fields();

DROP POLICY IF EXISTS evaluations_insert_sponsor ON public.evaluations;

CREATE OR REPLACE FUNCTION fn_guard_campaign_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (SELECT auth.role()) = 'service_role' OR fn_is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'pending'
     OR NEW.creator_confirmed IS TRUE
     OR NEW.verified_at IS NOT NULL
     OR NEW.disputed_at IS NOT NULL
     OR NEW.dispute_reason IS NOT NULL
     OR NEW.admin_resolved_at IS NOT NULL
     OR NEW.admin_resolution_note IS NOT NULL
     OR NEW.creator_rating_review_status IS NOT NULL THEN
    RAISE EXCEPTION 'A new campaign must start pending and unconfirmed by the creator';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_campaign_insert ON public.campaigns;
CREATE TRIGGER trg_guard_campaign_insert
  BEFORE INSERT ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION fn_guard_campaign_insert();

-- Also checked per the guardrail: contracts has NO insert policy for
-- non-admins at all (RLS default-deny), so no INSERT-side gap exists
-- there. No fix needed.
