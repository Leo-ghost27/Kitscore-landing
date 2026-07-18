-- 2026-07-13-brand-safety-scan.sql
--
-- Adds the LLM-based brand_safety scan as a compensating control on top of
-- the existing self-report questionnaire -- not a replacement. Industry
-- research check (2026-07-13 session): automated flagging is standard,
-- but "the final call stays with a person" for anything affecting money
-- or reputation. So: clean scans auto-apply (nothing to decide), flagged
-- scans hold for admin approval before touching a live score.
--
-- Also fixes a real bug found while building this: fn_recalc_brand_safety
-- hardcoded status = 'live_verified' for a 100% self-reported questionnaire
-- -- same label used for genuinely OAuth-verified components. Corrected to
-- 'self_reported', matching the honesty pattern used everywhere else
-- (linked vs verified platforms, live_verified vs self_reported evidence).

-- ── 1. Fix the status-label bug ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_recalc_brand_safety()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_creator uuid := coalesce(new.creator_id, old.creator_id);
  total numeric;
begin
  select 100 + coalesce(sum(p.penalty), 0) into total
    from brand_safety_answers a
    join brand_safety_penalties p on p.question_key = a.question_key and p.answer = a.answer
    where a.creator_id = target_creator;

  total := greatest(total, 0);

  insert into score_components (creator_id, component_key, label, weight, value, status)
  values (target_creator, 'brand_safety', 'Brand safety', 0.20, total, 'self_reported')
  on conflict (creator_id, component_key)
  do update set value = excluded.value, status = 'self_reported', updated_at = now();

  return new;
end;
$function$;

-- ── 2. brand_safety_scans: audit trail + review queue ────────────────────
CREATE TABLE IF NOT EXISTS public.brand_safety_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES public.creators(id) ON DELETE CASCADE,
  platform text NOT NULL,
  flagged boolean NOT NULL,
  categories text[] NOT NULL DEFAULT '{}',
  rationale text,
  model text NOT NULL,
  video_count_scanned integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'clean', -- clean | pending_review | approved | rejected
  scanned_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CHECK (status IN ('clean', 'pending_review', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_brand_safety_scans_creator_id ON public.brand_safety_scans(creator_id);
CREATE INDEX IF NOT EXISTS idx_brand_safety_scans_status ON public.brand_safety_scans(status);

ALTER TABLE public.brand_safety_scans ENABLE ROW LEVEL SECURITY;

-- Same admin-access pattern as evidence_uploads (fn_is_admin()). No
-- creator-facing access -- flagged content and rationale aren't shown to
-- the creator directly, only whether their score changed.
CREATE POLICY brand_safety_scans_admin_only ON public.brand_safety_scans
  FOR ALL
  USING (fn_is_admin())
  WITH CHECK (fn_is_admin());

-- ── 3. Admin decision function ────────────────────────────────────────────
-- Applies (or dismisses) a pending flagged scan. On approve: blends the
-- scan's flagged categories against the creator's self-reported answers,
-- taking the WORSE (more negative) penalty per mapped category, and writes
-- the result to score_components with an honest status. On reject: marks
-- the scan dismissed, no score change -- logged either way for later
-- calibration of the scanner's false-positive rate.
--
-- Category mapping is deliberately narrow -- only what's reliably
-- inferable from title/description text, matching brand_safety_scan.js:
--   gambling        -> question_key 'gambling',    worst-case penalty -25
--   adult_content    -> question_key 'adult',        worst-case penalty -30
--   anything else    -> question_key 'family_safe',  worst-case penalty -20
-- (political, misinformation, controversy_history, paid_disclosure are
-- intentionally excluded from automation -- self-report only, per the
-- 2026-07-13 design discussion.)
CREATE OR REPLACE FUNCTION public.fn_admin_apply_brand_safety_scan(p_scan_id uuid, p_decision text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scan record;
  v_gambling_flagged boolean;
  v_adult_flagged boolean;
  v_other_flagged boolean;
  v_self_gambling numeric;
  v_self_adult numeric;
  v_self_family numeric;
  v_self_other_total numeric; -- sum of every OTHER question_key's penalty, untouched
  v_effective_gambling numeric;
  v_effective_adult numeric;
  v_effective_family numeric;
  v_total numeric;
begin
  if not fn_is_admin() then
    raise exception 'ADMIN_ONLY: only admins can review brand safety scans';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'INVALID_DECISION: must be approved or rejected';
  end if;

  select * into v_scan from brand_safety_scans where id = p_scan_id and status = 'pending_review';
  if v_scan is null then
    raise exception 'NOT_FOUND: no pending scan with that id';
  end if;

  if p_decision = 'rejected' then
    update brand_safety_scans set status = 'rejected', reviewed_at = now() where id = p_scan_id;
    return;
  end if;

  -- approved: blend scan categories into the score
  v_gambling_flagged := 'gambling' = ANY(v_scan.categories);
  v_adult_flagged := 'adult_content' = ANY(v_scan.categories);
  v_other_flagged := EXISTS (
    SELECT 1 FROM unnest(v_scan.categories) c WHERE c NOT IN ('gambling', 'adult_content')
  );

  SELECT coalesce(sum(p.penalty) FILTER (WHERE a.question_key = 'gambling'), 0),
         coalesce(sum(p.penalty) FILTER (WHERE a.question_key = 'adult'), 0),
         coalesce(sum(p.penalty) FILTER (WHERE a.question_key = 'family_safe'), 0),
         coalesce(sum(p.penalty) FILTER (WHERE a.question_key NOT IN ('gambling', 'adult', 'family_safe')), 0)
    INTO v_self_gambling, v_self_adult, v_self_family, v_self_other_total
    FROM brand_safety_answers a
    JOIN brand_safety_penalties p ON p.question_key = a.question_key AND p.answer = a.answer
    WHERE a.creator_id = v_scan.creator_id;

  v_effective_gambling := CASE WHEN v_gambling_flagged THEN LEAST(coalesce(v_self_gambling,0), -25) ELSE coalesce(v_self_gambling,0) END;
  v_effective_adult := CASE WHEN v_adult_flagged THEN LEAST(coalesce(v_self_adult,0), -30) ELSE coalesce(v_self_adult,0) END;
  v_effective_family := CASE WHEN v_other_flagged THEN LEAST(coalesce(v_self_family,0), -20) ELSE coalesce(v_self_family,0) END;

  v_total := greatest(100 + v_effective_gambling + v_effective_adult + v_effective_family + coalesce(v_self_other_total,0), 0);

  INSERT INTO score_components (creator_id, component_key, label, weight, value, status)
  VALUES (v_scan.creator_id, 'brand_safety', 'Brand safety', 0.20, v_total, 'scan_reviewed')
  ON CONFLICT (creator_id, component_key)
  DO UPDATE SET value = excluded.value, status = 'scan_reviewed', updated_at = now();

  UPDATE brand_safety_scans SET status = 'approved', reviewed_at = now() WHERE id = p_scan_id;
end;
$function$;
