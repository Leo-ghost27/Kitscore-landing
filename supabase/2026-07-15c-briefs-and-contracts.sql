-- 2026-07-15-briefs-and-contracts.sql
--
-- Adds two independent-but-related feature sets, per the 2026-07-15
-- competitive review (creator-side gap analysis vs. industry norms):
--
-- 1. Open marketplace: sponsors post a public brief (budget, niche,
--    deliverables, deadline); creators browse and apply. Flips the
--    existing "sponsor discovers you via directory/score" model to
--    also support "creator discovers open opportunities" -- the
--    dominant loop at Aspire/Collabstr/Afluencer.
--
-- 2. Contracts + lightweight e-signature: deliverables, compensation,
--    usage rights, exclusivity, and an FTC disclosure flag, with a
--    typed-name-plus-timestamp signature from each party. Deliberately
--    NOT a cryptographic e-signature service (DocuSign-tier) -- this is
--    the same tier of signature most brief-value creator/brand deals
--    use in practice. No payment processing attached yet (see
--    docs/session-handoff-2026-07-15-v39.md and this session's
--    conversation for why escrow is sequenced later: it needs its own
--    dedicated Stripe Connect design, and contracts/briefs give it a
--    natural foundation to hang off of once built).
--
-- Neither feature touches money. A contract's `compensation` field is
-- free text (e.g. "$500 flat fee, net-30") for now, same pattern as
-- campaigns.budget_range already uses.

-- =============================================================
-- MARKETPLACE: campaign_briefs + brief_applications
-- =============================================================

create type brief_status as enum ('open', 'closed', 'filled');
create type brief_application_status as enum ('pending', 'shortlisted', 'accepted', 'rejected', 'withdrawn');

create table campaign_briefs (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references sponsors(id),
  title text not null,
  description text not null,
  niche text,
  platforms text[] not null default '{}',
  budget_range text,
  deliverables text,
  min_followers integer,
  application_deadline timestamptz,
  status brief_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table brief_applications (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references campaign_briefs(id) on delete cascade,
  creator_id uuid not null references creators(id),
  pitch_message text,
  proposed_rate text,
  status brief_application_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(brief_id, creator_id)
);

create index idx_campaign_briefs_status on campaign_briefs(status) where status = 'open';
create index idx_brief_applications_brief on brief_applications(brief_id);
create index idx_brief_applications_creator on brief_applications(creator_id);

-- Guard against applying to a brief that's no longer open, and against
-- a sponsor's own account "applying" to their own brief.
create or replace function fn_validate_brief_application()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_brief_status brief_status;
  v_brief_sponsor uuid;
begin
  select status, sponsor_id into v_brief_status, v_brief_sponsor
  from campaign_briefs where id = new.brief_id;

  if tg_op = 'INSERT' then
    if v_brief_status is distinct from 'open' then
      raise exception 'This brief is no longer accepting applications';
    end if;
    if v_brief_sponsor = new.creator_id then
      raise exception 'A sponsor account cannot apply to its own brief';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_validate_brief_application
  before insert on brief_applications
  for each row execute function fn_validate_brief_application();

alter table campaign_briefs enable row level security;
alter table brief_applications enable row level security;

-- campaign_briefs: anyone authenticated can browse OPEN briefs (the
-- marketplace view); a sponsor sees/manages all of their own regardless
-- of status; admin sees everything.
create policy campaign_briefs_select_open ON campaign_briefs FOR SELECT
  USING (status = 'open' OR sponsor_id = fn_current_profile_id() OR fn_is_admin());
create policy campaign_briefs_insert_own ON campaign_briefs FOR INSERT
  WITH CHECK (sponsor_id = fn_current_profile_id() OR fn_is_admin());
create policy campaign_briefs_update_own ON campaign_briefs FOR UPDATE
  USING (sponsor_id = fn_current_profile_id() OR fn_is_admin());
create policy campaign_briefs_delete_own ON campaign_briefs FOR DELETE
  USING (sponsor_id = fn_current_profile_id() OR fn_is_admin());

-- brief_applications: creator sees/manages their own applications;
-- sponsor sees applications to their own briefs and can update status
-- (accept/reject/shortlist) but not the creator's pitch content.
create policy brief_applications_creator_select ON brief_applications FOR SELECT
  USING (creator_id = fn_current_profile_id() OR fn_is_admin());
create policy brief_applications_sponsor_select ON brief_applications FOR SELECT
  USING (fn_is_admin() OR EXISTS (
    SELECT 1 FROM campaign_briefs cb WHERE cb.id = brief_applications.brief_id AND cb.sponsor_id = fn_current_profile_id()
  ));
create policy brief_applications_creator_insert ON brief_applications FOR INSERT
  WITH CHECK (creator_id = fn_current_profile_id() OR fn_is_admin());
create policy brief_applications_creator_update ON brief_applications FOR UPDATE
  USING (creator_id = fn_current_profile_id() OR fn_is_admin());
create policy brief_applications_sponsor_update ON brief_applications FOR UPDATE
  USING (fn_is_admin() OR EXISTS (
    SELECT 1 FROM campaign_briefs cb WHERE cb.id = brief_applications.brief_id AND cb.sponsor_id = fn_current_profile_id()
  ));

-- =============================================================
-- CONTRACTS + lightweight e-signature
-- =============================================================

create type contract_status as enum ('draft', 'sent', 'signed_by_creator', 'signed_by_sponsor', 'fully_signed', 'void');

create table contracts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id),
  brief_application_id uuid references brief_applications(id),
  sponsor_id uuid not null references sponsors(id),
  creator_id uuid not null references creators(id),
  title text not null,
  deliverables text not null,
  compensation text not null,
  usage_rights text,
  exclusivity_terms text,
  ftc_disclosure_required boolean not null default true,
  additional_terms text,
  status contract_status not null default 'draft',
  sponsor_signed_at timestamptz,
  sponsor_signature_name text,
  creator_signed_at timestamptz,
  creator_signature_name text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_contracts_sponsor on contracts(sponsor_id);
create index idx_contracts_creator on contracts(creator_id);

-- Once a contract leaves 'draft', its terms are locked -- only
-- signature fields and status may change from then on. Each party may
-- only ever set their own signature. When both are signed, status
-- auto-flips to fully_signed regardless of what the caller sent.
create or replace function fn_validate_contract_changes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if fn_is_admin() then
    return new;
  end if;

  if new.status = 'void' and old.status != 'void' then
    if new.sponsor_id != fn_current_profile_id() then
      raise exception 'Only the sponsor on this contract can void it';
    end if;
  end if;

  if old.status != 'draft' then
    if new.title is distinct from old.title
       or new.deliverables is distinct from old.deliverables
       or new.compensation is distinct from old.compensation
       or new.usage_rights is distinct from old.usage_rights
       or new.exclusivity_terms is distinct from old.exclusivity_terms
       or new.ftc_disclosure_required is distinct from old.ftc_disclosure_required
       or new.additional_terms is distinct from old.additional_terms then
      raise exception 'Contract terms are locked once sent -- void this contract and create a new one to change terms';
    end if;
  end if;

  if new.sponsor_signed_at is distinct from old.sponsor_signed_at
     or new.sponsor_signature_name is distinct from old.sponsor_signature_name then
    if new.sponsor_id != fn_current_profile_id() then
      raise exception 'Only the sponsor on this contract can sign as the sponsor';
    end if;
    if old.sponsor_signed_at is not null then
      raise exception 'This contract has already been signed by the sponsor';
    end if;
  end if;

  if new.creator_signed_at is distinct from old.creator_signed_at
     or new.creator_signature_name is distinct from old.creator_signature_name then
    if new.creator_id != fn_current_profile_id() then
      raise exception 'Only the creator on this contract can sign as the creator';
    end if;
    if old.creator_signed_at is not null then
      raise exception 'This contract has already been signed by the creator';
    end if;
  end if;

  if new.sponsor_signed_at is not null and new.creator_signed_at is not null then
    new.status := 'fully_signed';
  elsif new.sponsor_signed_at is not null then
    new.status := 'signed_by_sponsor';
  elsif new.creator_signed_at is not null then
    new.status := 'signed_by_creator';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_validate_contract_changes
  before update on contracts
  for each row execute function fn_validate_contract_changes();

alter table contracts enable row level security;

create policy contracts_select_involved ON contracts FOR SELECT
  USING (sponsor_id = fn_current_profile_id() OR creator_id = fn_current_profile_id() OR fn_is_admin());
create policy contracts_insert_involved ON contracts FOR INSERT
  WITH CHECK (
    created_by = fn_current_profile_id()
    AND (sponsor_id = fn_current_profile_id() OR creator_id = fn_current_profile_id())
  );
create policy contracts_update_involved ON contracts FOR UPDATE
  USING (sponsor_id = fn_current_profile_id() OR creator_id = fn_current_profile_id() OR fn_is_admin());
