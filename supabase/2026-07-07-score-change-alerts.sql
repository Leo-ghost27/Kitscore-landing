-- 2026-07-07-score-change-alerts.sql
--
-- First build pass on "score-change alerts" (Team-tier feature promised
-- on pricing.html / team.html's COMING_FEATURES since before this
-- session -- "Get notified the moment an approved creator's trust score
-- drops"). Scoped to what's actually measurable today: a drop in
-- creators.trust_score since the evaluation was approved. New-red-flag
-- and disclosure-lapse detection are NOT included -- there's no history
-- table for risk flags to diff against, and building one is a separate,
-- larger piece of work. This migration and the UI built on top of it
-- only claim the trust-score-drop part.
--
-- Delivery is in-app only for this pass (a banner in team.html), not
-- email. The signup-notification trigger/Resend infra could plausibly
-- be extended to this later, but that's an explicit decision to make,
-- not something to fold in silently here.

-- =============================================================
-- 1. Capture a baseline: the creator's trust_score at the moment a
--    team owner approves an evaluation. Without this there's nothing
--    to diff the current score against.
-- =============================================================
ALTER TABLE public.evaluations
  ADD COLUMN trust_score_at_approval numeric;

CREATE OR REPLACE FUNCTION public.fn_capture_trust_score_at_approval()
RETURNS trigger
LANGUAGE plpgsql SET search_path = 'public'
AS $$
BEGIN
  IF NEW.approval_status = 'approved' AND (OLD.approval_status IS DISTINCT FROM 'approved') THEN
    SELECT trust_score INTO NEW.trust_score_at_approval FROM creators WHERE id = NEW.creator_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_capture_trust_score_at_approval
  BEFORE UPDATE ON public.evaluations
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_capture_trust_score_at_approval();

-- Backfill for evaluations already approved before this migration.
-- Honest limitation: this baseline is captured NOW, at migration time,
-- not at the historical moment of approval -- there's no way to recover
-- what the score actually was back then. Any drop that already happened
-- before today won't be caught for these rows; only drops from this
-- point forward will be. Documented in the session handoff, not hidden.
UPDATE public.evaluations e
SET trust_score_at_approval = c.trust_score
FROM public.creators c
WHERE e.creator_id = c.id
  AND e.approval_status = 'approved'
  AND e.trust_score_at_approval IS NULL;

-- =============================================================
-- 2. fn_team_score_alerts -- read function, same SECURITY DEFINER
--    pattern as fn_team_roster/fn_team_notes/fn_team_clients.
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_team_score_alerts(p_team_id uuid)
RETURNS TABLE(
  evaluation_id uuid, creator_id uuid, creator_name text,
  score_then numeric, score_now numeric, approved_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT e.id, c.id, p.display_name, e.trust_score_at_approval, c.trust_score, e.reviewed_at
  FROM evaluations e
  JOIN creators c ON c.id = e.creator_id
  JOIN profiles p ON p.id = c.id
  WHERE e.team_id = p_team_id
    AND fn_is_team_member(p_team_id)
    AND e.approval_status = 'approved'
    AND e.trust_score_at_approval IS NOT NULL
    AND c.trust_score < e.trust_score_at_approval
  ORDER BY (e.trust_score_at_approval - c.trust_score) DESC;
$$;
GRANT EXECUTE ON FUNCTION public.fn_team_score_alerts(uuid) TO authenticated;
