-- Sponsor-side gaps identified in review of directory.html and team.html:
-- 1. Saved searches — confirmed absent from the whole schema. Sponsors had
--    no way to persist a filter combination (query text, niche, min trust
--    score, sort) and re-run it later; directory.html only had a niche
--    filter + sort, no free-text search at all, so we add that too.
-- 2. Team billing visibility — plan/subscription_status/usage live on the
--    team owner's sponsors row and were only ever surfaced to the owner
--    (billing-portal.js, team.html's upgrade banner). Non-owner team
--    members had no way to see plan status, so a past_due subscription
--    silently degraded their access with zero explanation. Added a
--    fn_team_billing_summary RPC any team member can call for their own
--    team, mirroring the fn_team_roster / fn_is_team_member pattern.

create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references public.sponsors(id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0 and char_length(name) <= 60),
  query text,
  niche text,
  min_trust_score numeric,
  sort_by text not null default 'trust_score' check (sort_by in ('trust_score', 'verified')),
  created_at timestamptz not null default now()
);

create index if not exists idx_saved_searches_sponsor_id on public.saved_searches(sponsor_id);

alter table public.saved_searches enable row level security;

create policy saved_searches_owner_only on public.saved_searches
  for all
  using (sponsor_id = fn_current_profile_id() or fn_is_admin())
  with check (sponsor_id = fn_current_profile_id() or fn_is_admin());

grant select, insert, update, delete on public.saved_searches to authenticated;

-- Cap saved searches per sponsor at the app layer's discretion is fragile
-- (client could skip the check), so enforce a ceiling in the DB too.
create or replace function public.fn_enforce_saved_search_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (select count(*) from saved_searches where sponsor_id = new.sponsor_id) >= 20 then
    raise exception 'Saved search limit reached (20). Delete an existing saved search first.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_saved_search_cap on public.saved_searches;
create trigger trg_enforce_saved_search_cap
  before insert on public.saved_searches
  for each row execute function public.fn_enforce_saved_search_cap();

-- Team billing visibility: any member (not just the owner) can see the
-- team's plan, subscription status, and usage. Payment method / invoices
-- stay owner-only (Stripe portal session is created for the owner's
-- customer ID in lib/handlers/billing-portal.js), but *visibility* into
-- whether the subscription is active/past_due/cancelled, and who holds
-- billing responsibility, should not require the owner role.
create or replace function public.fn_team_billing_summary(p_team_id uuid)
returns table(
  plan plan_tier,
  subscription_status text,
  owner_display_name text,
  evals_used_this_period integer,
  period_start timestamptz,
  has_payment_method boolean
)
language sql
stable security definer
set search_path to 'public'
as $$
  select
    t.plan,
    s.subscription_status,
    p.display_name,
    s.evals_used_this_period,
    s.period_start,
    (s.stripe_customer_id is not null)
  from teams t
  join sponsors s on s.id = t.owner_id
  join profiles p on p.id = t.owner_id
  where t.id = p_team_id
    and fn_is_team_member(p_team_id);
$$;

grant execute on function public.fn_team_billing_summary(uuid) to authenticated;
