-- RLS policy performance cleanup -- 2026-07-04
--
-- Fixes two categories of WARN-level findings from Supabase's performance
-- advisor. Both are precautionary hygiene for future scale -- at current
-- data volume (dozens of rows per table) neither has a measurable
-- real-world effect today.
--
-- Verified via SET ROLE (anon, and authenticated with request.jwt.claim.role
-- simulated, since auth.role()/auth.uid() read from JWT claims that a raw
-- SQL session doesn't otherwise populate) that row visibility is byte-for-
-- byte unchanged after these edits for profiles, creators, and campaigns.

-- =============================================================
-- PART 1: wrap direct auth.uid()/auth.role() calls in scalar subqueries
-- so Postgres evaluates them once per query (InitPlan) instead of once
-- per row. Zero logical change. Policies using fn_current_profile_id()/
-- fn_is_admin() (STABLE wrapper functions, no row-dependent args) were
-- NOT flagged by the advisor and are untouched -- Postgres already
-- hoists those correctly.
-- =============================================================

drop policy if exists profiles_select_own on public.profiles;
-- (superseded by profiles_select_merged below -- see part 2)

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update
  using (auth_user_id = (select auth.uid()) OR fn_is_admin());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert
  with check (auth_user_id = (select auth.uid()));

drop policy if exists score_components_select_authenticated on public.score_components;
create policy score_components_select_authenticated on public.score_components for select
  using ((select auth.role()) = 'authenticated');

drop policy if exists teams_insert on public.teams;
create policy teams_insert on public.teams for insert
  with check (owner_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = (select auth.uid())));

drop policy if exists teams_update on public.teams;
create policy teams_update on public.teams for update
  using (owner_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = (select auth.uid())))
  with check (owner_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = (select auth.uid())));

drop policy if exists teams_delete on public.teams;
create policy teams_delete on public.teams for delete
  using (owner_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = (select auth.uid())));

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select
  using (owner_id IN (SELECT profiles.id FROM profiles WHERE profiles.auth_user_id = (select auth.uid())) OR fn_is_team_member(id));

drop policy if exists team_invites_accept_update on public.team_invites;
create policy team_invites_accept_update on public.team_invites for update
  using (accepted_at IS NULL AND expires_at > now() AND email = (SELECT p.email FROM profiles p WHERE p.auth_user_id = (select auth.uid())));

-- =============================================================
-- PART 2: merge pairs of permissive policies covering the same
-- table+action into one. A-OR-B as two separate permissive policies
-- produces an identical result set to a single policy with condition
-- A-OR-B -- pure performance refactor, no behavior change.
--
-- Deferred (not in this file): evaluations, score_components (write side),
-- sponsors, team_members. Each of these overlaps involves a FOR ALL
-- policy that would need splitting into per-command policies to merge
-- safely without touching INSERT/UPDATE/DELETE behavior -- more surgery
-- than current data volume justifies right now. Still flagged WARN in the
-- advisor; revisit in a dedicated session if/when it matters.
-- =============================================================

-- profiles: two permissive SELECT policies merged into one (also
-- picks up the auth.uid() wrap from part 1 for what was profiles_select_own)
drop policy if exists profiles_select_creators_public on public.profiles;
create policy profiles_select_merged on public.profiles for select
  using (role = 'creator' OR auth_user_id = (select auth.uid()) OR fn_is_admin());

-- creators: creators_select_authenticated had no TO restriction, so it was
-- being evaluated for anon too, uselessly (auth.role()='authenticated' is
-- always false for anon). Scoping it explicitly TO authenticated removes
-- it from anon's evaluation without touching creators_select_public_directory
-- (TO anon, using true) at all.
drop policy if exists creators_select_authenticated on public.creators;
create policy creators_select_authenticated on public.creators for select
  to authenticated
  using ((select auth.role()) = 'authenticated');

-- campaigns: campaigns_select_involved (own campaigns) and
-- campaigns_select_verified_public (any verified campaign, if
-- authenticated) merged into one OR'd policy.
drop policy if exists campaigns_select_involved on public.campaigns;
drop policy if exists campaigns_select_verified_public on public.campaigns;
create policy campaigns_select_merged on public.campaigns for select
  using (
    creator_id = fn_current_profile_id()
    OR sponsor_id = fn_current_profile_id()
    OR fn_is_admin()
    OR (status = 'verified' AND (select auth.role()) = 'authenticated')
  );
