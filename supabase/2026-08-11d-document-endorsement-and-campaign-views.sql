-- 2026-08-11d, same drift-audit batch. Creator-rates-sponsor endorsement
-- validation (the reverted-to-original version, after this session's own
-- unnecessary widening of it was reverted -- see 2026-08-10a2/c/d), plus
-- the campaign and deliverable-tracker view functions both sides' UIs
-- read from. Spot-checked: correct mutual-reveal gating (both sides'
-- ratings hidden until both submit, or 14 days pass), correct plan
-- gating on the sponsor deliverable tracker (Team plan only). No bugs
-- found. No logic changes, pure backfill.

CREATE OR REPLACE FUNCTION public.fn_validate_creator_endorsement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
begin
  if fn_is_admin() then
    return new;
  end if;

  if (new.creator_overall_rating is distinct from old.creator_overall_rating)
     or (new.creator_payment_promptness_rating is distinct from old.creator_payment_promptness_rating)
     or (new.creator_brief_accuracy_rating is distinct from old.creator_brief_accuracy_rating)
     or (new.would_work_again is distinct from old.would_work_again)
     or (new.creator_endorsement_notes is distinct from old.creator_endorsement_notes)
     or (new.creator_endorsement_public_consent is distinct from old.creator_endorsement_public_consent)
     or (new.creator_endorsement_submitted_at is distinct from old.creator_endorsement_submitted_at) then

    if new.creator_id != fn_current_profile_id() then
      raise exception 'Only the creator on this campaign can rate the sponsor';
    end if;
    if old.status != 'verified' then
      raise exception 'Sponsor ratings can only be submitted on verified campaigns';
    end if;
    if old.creator_endorsement_submitted_at is not null then
      raise exception 'Sponsor rating already submitted for this campaign';
    end if;
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_validate_creator_endorsement ON public.campaigns;
CREATE TRIGGER trg_validate_creator_endorsement
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION fn_validate_creator_endorsement();

CREATE OR REPLACE FUNCTION public.fn_creator_campaigns()
RETURNS TABLE(id uuid, creator_id uuid, sponsor_id uuid, name text, status campaign_status, budget_range text, objective text, creator_confirmed boolean, sponsor_confirmed boolean, dispute_reason text, verified_at timestamp with time zone, created_at timestamp with time zone, sponsor_company_name text, sponsor_rating smallint, communication_rating smallint, professionalism_rating smallint, deliverable_quality_rating smallint, would_hire_again boolean, endorsement_notes text, endorsement_public_consent boolean, endorsement_submitted_at timestamp with time zone, creator_endorsement_submitted_at timestamp with time zone, reveal_ready boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select
    c.id, c.creator_id, c.sponsor_id, c.name, c.status, c.budget_range, c.objective,
    c.creator_confirmed, c.sponsor_confirmed, c.dispute_reason, c.verified_at, c.created_at,
    s.company_name,
    case when r.ready then c.sponsor_rating else null end,
    case when r.ready then c.communication_rating else null end,
    case when r.ready then c.professionalism_rating else null end,
    case when r.ready then c.deliverable_quality_rating else null end,
    case when r.ready then c.would_hire_again else null end,
    case when r.ready then c.endorsement_notes else null end,
    c.endorsement_public_consent,
    c.endorsement_submitted_at,
    c.creator_endorsement_submitted_at,
    r.ready
  from campaigns c
  join sponsors s on s.id = c.sponsor_id
  cross join lateral (
    select (c.endorsement_submitted_at is not null and c.creator_endorsement_submitted_at is not null)
        or (c.verified_at is not null and c.verified_at < now() - interval '14 days'
            and (c.endorsement_submitted_at is not null or c.creator_endorsement_submitted_at is not null))
      as ready
  ) r
  where c.creator_id = fn_current_profile_id();
$function$;

CREATE OR REPLACE FUNCTION public.fn_sponsor_campaigns()
RETURNS TABLE(id uuid, creator_id uuid, sponsor_id uuid, name text, status campaign_status, budget_range text, objective text, creator_confirmed boolean, sponsor_confirmed boolean, dispute_reason text, verified_at timestamp with time zone, created_at timestamp with time zone, creator_display_name text, endorsement_submitted_at timestamp with time zone, creator_overall_rating smallint, creator_payment_promptness_rating smallint, creator_brief_accuracy_rating smallint, would_work_again boolean, creator_endorsement_notes text, creator_endorsement_public_consent boolean, creator_endorsement_submitted_at timestamp with time zone, reveal_ready boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select
    c.id, c.creator_id, c.sponsor_id, c.name, c.status, c.budget_range, c.objective,
    c.creator_confirmed, c.sponsor_confirmed, c.dispute_reason, c.verified_at, c.created_at,
    p.display_name,
    c.endorsement_submitted_at,
    case when r.ready then c.creator_overall_rating else null end,
    case when r.ready then c.creator_payment_promptness_rating else null end,
    case when r.ready then c.creator_brief_accuracy_rating else null end,
    case when r.ready then c.would_work_again else null end,
    case when r.ready then c.creator_endorsement_notes else null end,
    c.creator_endorsement_public_consent,
    c.creator_endorsement_submitted_at,
    r.ready
  from campaigns c
  join profiles p on p.id = c.creator_id
  cross join lateral (
    select (c.endorsement_submitted_at is not null and c.creator_endorsement_submitted_at is not null)
        or (c.verified_at is not null and c.verified_at < now() - interval '14 days'
            and (c.endorsement_submitted_at is not null or c.creator_endorsement_submitted_at is not null))
      as ready
  ) r
  where c.sponsor_id = fn_current_profile_id();
$function$;

CREATE OR REPLACE FUNCTION public.fn_creator_deliverable_tracker()
RETURNS TABLE(contract_id uuid, contract_title text, sponsor_id uuid, sponsor_name text, item_id uuid, description text, due_date date, requires_approval boolean, content_status text, revision_note text, revision_count integer, revision_limit integer, completed_at timestamp with time zone, is_overdue boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select
    c.id, c.title, c.sponsor_id, s.company_name,
    i.id, i.description, i.due_date, i.requires_approval, i.content_status,
    i.revision_note, i.revision_count, i.revision_limit, i.completed_at,
    (i.due_date is not null and i.due_date < current_date and i.completed_at is null)
  from contract_deliverable_items i
  join contracts c on c.id = i.contract_id
  join sponsors s on s.id = c.sponsor_id
  where c.creator_id = fn_current_profile_id()
    and c.status <> 'void'
    and i.completed_at is null
  order by (i.due_date is null), i.due_date;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sponsor_deliverable_tracker()
RETURNS TABLE(contract_id uuid, contract_title text, creator_id uuid, creator_name text, item_id uuid, description text, due_date date, requires_approval boolean, content_status text, revision_count integer, revision_limit integer, completed_at timestamp with time zone, is_overdue boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select
    c.id, c.title, c.creator_id, p.display_name,
    i.id, i.description, i.due_date, i.requires_approval, i.content_status,
    i.revision_count, i.revision_limit, i.completed_at,
    (i.due_date is not null and i.due_date < current_date and i.completed_at is null)
  from contract_deliverable_items i
  join contracts c on c.id = i.contract_id
  join profiles p on p.id = c.creator_id
  where c.sponsor_id = fn_current_profile_id()
    and c.status <> 'void'
    and i.completed_at is null
    and exists (select 1 from sponsors s where s.id = fn_current_profile_id() and s.plan = 'team')
  order by (i.due_date is null), i.due_date;
$function$;

CREATE OR REPLACE FUNCTION public.fn_contract_roi_report(p_contract_id uuid)
RETURNS TABLE(contract_title text, creator_id uuid, creator_name text, creator_trust_score numeric, escrow_amount_cents integer, escrow_status text, items_total integer, items_completed integer, deliverable_submitted_at timestamp with time zone, released_at timestamp with time zone, days_to_deliver integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select
    c.title, c.creator_id, p.display_name, cr.trust_score,
    c.escrow_amount_cents, c.escrow_status,
    (select count(*) from contract_deliverable_items i where i.contract_id = c.id)::integer,
    (select count(*) from contract_deliverable_items i where i.contract_id = c.id and i.completed_at is not null)::integer,
    c.deliverable_submitted_at, c.released_at,
    case when c.deliverable_submitted_at is not null
      then extract(day from c.deliverable_submitted_at - c.funded_at)::integer
      else null end
  from contracts c
  join profiles p on p.id = c.creator_id
  join creators cr on cr.id = c.creator_id
  where c.id = p_contract_id
    and (c.sponsor_id = fn_current_profile_id() or fn_is_admin());
$function$;

CREATE OR REPLACE FUNCTION public.fn_creator_campaign_performance_recap(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_campaign record;
  v_window_end timestamptz;
  v_platforms jsonb;
begin
  select * into v_campaign from campaigns where id = p_campaign_id;
  if v_campaign is null then
    raise exception 'Campaign not found';
  end if;
  if v_campaign.creator_id <> fn_current_profile_id() then
    raise exception 'Not authorized to view this campaign''s performance recap';
  end if;

  v_window_end := coalesce(v_campaign.completed_at, now());

  select coalesce(jsonb_agg(jsonb_build_object(
    'platform', pc.platform,
    'currentFollowerCount', pc.follower_count,
    'currentVideoCount', pc.video_count,
    'currentViewCount', pc.view_count,
    'windowStartFollowerCount', (
      select h.follower_count from platform_follower_history h
      where h.creator_id = v_campaign.creator_id and h.platform = pc.platform
        and h.recorded_at <= v_campaign.created_at
      order by h.recorded_at desc limit 1
    ),
    'windowStartSnapshotAt', (
      select h.recorded_at from platform_follower_history h
      where h.creator_id = v_campaign.creator_id and h.platform = pc.platform
        and h.recorded_at <= v_campaign.created_at
      order by h.recorded_at desc limit 1
    ),
    'windowEndFollowerCount', (
      select h.follower_count from platform_follower_history h
      where h.creator_id = v_campaign.creator_id and h.platform = pc.platform
        and h.recorded_at <= v_window_end
      order by h.recorded_at desc limit 1
    ),
    'windowEndSnapshotAt', (
      select h.recorded_at from platform_follower_history h
      where h.creator_id = v_campaign.creator_id and h.platform = pc.platform
        and h.recorded_at <= v_window_end
      order by h.recorded_at desc limit 1
    )
  )), '[]'::jsonb)
  into v_platforms
  from platform_connections pc
  where pc.creator_id = v_campaign.creator_id;

  return jsonb_build_object(
    'campaignId', v_campaign.id,
    'campaignName', v_campaign.name,
    'windowStart', v_campaign.created_at,
    'windowEnd', v_window_end,
    'stillActive', v_campaign.completed_at is null,
    'platforms', v_platforms
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_renewal_recommendations()
RETURNS TABLE(creator_id uuid, creator_name text, trust_score numeric, last_completed_at timestamp with time zone, would_hire_again boolean, sponsor_rating smallint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with best_campaign as (
    select distinct on (camp.creator_id)
      camp.creator_id,
      coalesce(camp.verified_at, camp.created_at) as last_at,
      camp.would_hire_again, camp.sponsor_rating
    from campaigns camp
    where camp.sponsor_id = fn_current_profile_id()
      and camp.status = 'verified'
    order by camp.creator_id, coalesce(camp.verified_at, camp.created_at) desc
  )
  select
    bc.creator_id, p.display_name, cr.trust_score,
    bc.last_at, bc.would_hire_again, bc.sponsor_rating
  from best_campaign bc
  join profiles p on p.id = bc.creator_id
  join creators cr on cr.id = bc.creator_id
  where (bc.would_hire_again is distinct from false)
    and not exists (
      select 1 from contracts c
      where c.sponsor_id = fn_current_profile_id()
        and c.creator_id = bc.creator_id
        and c.status <> 'void'
        and not (
          c.escrow_status in ('released','refunded','settled')
          or (c.escrow_amount_cents is null and c.deliverable_submitted_at is not null)
        )
    )
  order by bc.last_at desc
  limit 12;
$function$;
