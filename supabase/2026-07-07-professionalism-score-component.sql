-- Wires professionalism_rating (already collected on campaigns, already
-- feeding reliability_score via compute_creator_reliability) into
-- score_components as 'professionalism', so trust_score picks it up too.
--
-- Additive only: does not modify compute_creator_reliability, reliability_score,
-- or any existing trigger. Mirrors the existing fn_recalc_brand_safety pattern.
--
-- WEIGHT PLACEHOLDER: set to 0.20 to match brand_safety's weight. Total
-- score_components weights across all 5 intended factors should be reviewed
-- together before this goes live — flagging for Gina to confirm the final
-- weight split (audience_authenticity / engagement_quality / brand_safety /
-- content_consistency / professionalism) rather than guessing at 20% each.

CREATE OR REPLACE FUNCTION public.fn_recalc_professionalism()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  target_creator uuid := new.creator_id;
  v_avg numeric;
begin
  select coalesce(avg(professionalism_rating), 0) * 20
  into v_avg
  from campaigns
  where creator_id = target_creator
    and endorsement_submitted_at is not null;

  insert into score_components (creator_id, component_key, label, weight, value, status)
  values (target_creator, 'professionalism', 'Professionalism', 0.20, v_avg, 'live_verified')
  on conflict (creator_id, component_key)
  do update set value = excluded.value, status = 'live_verified', updated_at = now();

  return new;
end;
$function$;

-- Fires on the same event that already triggers compute_creator_reliability
-- (endorsement newly submitted), so professionalism and reliability_score
-- stay in sync without duplicating the mutual-confirm / rating validation logic.
CREATE TRIGGER trg_recalc_professionalism
AFTER UPDATE ON public.campaigns
FOR EACH ROW
WHEN (new.endorsement_submitted_at IS NOT NULL AND old.endorsement_submitted_at IS NULL)
EXECUTE FUNCTION fn_recalc_professionalism();

-- Backfill: populate professionalism for creators who already have
-- endorsement data, so trust_score updates immediately for existing
-- campaigns instead of only on the next future endorsement.
DO $$
declare
  r record;
begin
  for r in
    select distinct creator_id from campaigns where endorsement_submitted_at is not null
  loop
    insert into score_components (creator_id, component_key, label, weight, value, status)
    select
      r.creator_id,
      'professionalism',
      'Professionalism',
      0.20,
      coalesce(avg(professionalism_rating), 0) * 20,
      'live_verified'
    from campaigns
    where creator_id = r.creator_id and endorsement_submitted_at is not null
    on conflict (creator_id, component_key)
    do update set value = excluded.value, status = 'live_verified', updated_at = now();
  end loop;
end $$;
