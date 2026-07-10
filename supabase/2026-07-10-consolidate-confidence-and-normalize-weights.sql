-- 2026-07-10-consolidate-confidence-and-normalize-weights.sql
--
-- Follow-up to 2026-07-10-scoring-fixes-and-platform-engagement.sql.
--
-- 1. Confidence had the SAME duplicate-formula bug as reliability did:
--    two functions (fn_recalc_confidence() and
--    fn_recalc_creator_confidence(uuid)) both wrote creators.confidence,
--    wired to overlapping triggers. Confirmed via live data that
--    fn_recalc_creator_confidence() (called from fn_recalc_trust_score(),
--    which fires alphabetically after the score_components-level
--    duplicate trigger) is what actually lands. Unlike the reliability
--    case, fn_recalc_confidence() also had its own separate trigger on
--    the `campaigns` table (trg_recalc_confidence_campaigns) -- the ONLY
--    thing keeping confidence fresh when a campaign gets verified without
--    a score_components change in the same transaction. Repointed that
--    trigger to call the sophisticated formula via a small wrapper
--    (trg_confidence_on_campaign_verified) before dropping the old
--    function, so that path isn't lost. Also widened
--    trg_recalc_trust_score to fire on status-only score_components
--    changes too (closing a gap the old duplicate used to accidentally
--    cover).
--
-- 2. Normalized the 3 oldest seed creators' score_components.weight to
--    0.20 (flat, matching every fn_recalc_* insert since) -- they'd been
--    stuck on a pre-standardization scheme (0.30/0.20/0.15/0.25/0.10)
--    since the June 19 seed batch, because ON CONFLICT DO UPDATE never
--    touched the weight column. Confirmed all creators now sum to
--    consistent per-component weights, and trust_score recomputed
--    automatically via the existing trigger.

create or replace function public.trg_confidence_on_campaign_verified()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform fn_recalc_creator_confidence(coalesce(new.creator_id, old.creator_id));
  return new;
end;
$function$;

drop trigger if exists trg_recalc_confidence_campaigns on public.campaigns;
create trigger trg_recalc_confidence_campaigns
  after insert or update of status
  on public.campaigns
  for each row
  execute function trg_confidence_on_campaign_verified();

drop trigger if exists trg_recalc_confidence_components on public.score_components;
drop function if exists public.fn_recalc_confidence();

drop trigger if exists trg_recalc_trust_score on public.score_components;
create trigger trg_recalc_trust_score
  after insert or delete or update of value, weight, status
  on public.score_components
  for each row
  execute function fn_recalc_trust_score();

update score_components set weight = 0.20, updated_at = now()
where weight != 0.20;
