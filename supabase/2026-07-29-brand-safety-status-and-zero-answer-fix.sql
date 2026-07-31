-- Two real issues found while reviewing the live dashboard, confirmed
-- via code (not display alone) before fixing either:
--
-- 1. fn_recalc_brand_safety always writes status='self_reported', but
--    dashboard.html's status->tag mapping only had cases for
--    'live_verified' and 'evidence_submitted' -- anything else,
--    including this perfectly normal status, silently fell through to
--    a generic "Pending" tag. A creator who fully completed all 8
--    questions and scored 100 was shown as still "Pending" forever.
--    Fixed in app/dashboard.html (added a 'self_reported' -> 'tag-self'
--    / "Self-reported" case) -- no DB change needed for this part.
--
-- 2. The bigger issue: `100 + sum(penalty)` over ZERO answered
--    questions is just 100 -- a creator who has never touched the
--    brand safety questionnaire scores identically to one who answered
--    all 8 with the best possible answer on every question. "No data"
--    and "no risk" were being treated as the same thing.
--
--    Fix: only write a score_components row once the creator has
--    answered at least 1 question. Zero answers now correctly falls
--    through to the dashboard's existing "no component row exists yet"
--    path, which already renders as Pending / "--" for every other
--    not-yet-started component -- no new status value needed, this
--    just makes brand_safety consistent with how every other component
--    already behaves when nothing has been submitted.
--
--    Partial completion (e.g. 3 of 8 answered) still writes a real,
--    self-reported value reflecting what's actually been disclosed so
--    far -- that's legitimate signal, not the same problem as zero
--    answers. It's now labeled "Self-reported" instead of falsely
--    "Pending" per fix #1, so it's no longer misleading either way.
CREATE OR REPLACE FUNCTION public.fn_recalc_brand_safety()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_creator uuid := coalesce(new.creator_id, old.creator_id);
  total numeric;
  answered_count integer;
begin
  select count(*) into answered_count
  from brand_safety_answers
  where creator_id = target_creator;

  if answered_count = 0 then
    -- Nothing answered (or the last answer was just removed) -- delete
    -- any existing row rather than leave a stale/phantom score behind.
    delete from score_components
    where creator_id = target_creator and component_key = 'brand_safety';
    return new;
  end if;

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
