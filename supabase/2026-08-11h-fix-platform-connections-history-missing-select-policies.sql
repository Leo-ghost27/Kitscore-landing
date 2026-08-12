-- 2026-08-11h-fix-platform-connections-history-missing-select-policies.sql
--
-- Found during the same RLS policy audit as 2026-08-11g. platform_
-- connections and platform_follower_history both have RLS enabled with
-- ZERO policies -- default-deny, so every direct client query against
-- them returns no rows for anyone. Fails safe/closed (not a security
-- hole), but a real, live functional break: app/evaluate.html -- the
-- sponsor-paid ($29) creator evaluation report -- queries both tables
-- directly via the anon/authenticated client, so the "connected
-- platforms" section of every evaluation report currently renders
-- empty, and the follower-history fetch returns nothing. Confirmed via
-- grep that every write path to these tables goes through the
-- service-role `admin` client in lib/handlers/ (OAuth callbacks, cron
-- resync jobs) -- unaffected by RLS either way, so this is purely a
-- missing-read-policy gap on the client-facing side.
--
-- Fix follows the exact precedent already established for the sibling
-- table used in the same report, audience_demographics: owner (the
-- creator) can read their own rows; any authenticated sponsor can read
-- any creator's rows (broad sponsor-read is the established pattern
-- here -- evaluation/directory browsing needs this for creators with no
-- prior relationship to the viewing sponsor, same as audience data);
-- admin can read everything.

CREATE POLICY platform_connections_select_own ON public.platform_connections
  FOR SELECT USING (creator_id = fn_current_profile_id() OR fn_is_admin());

CREATE POLICY platform_connections_sponsor_read ON public.platform_connections
  FOR SELECT USING (fn_current_role() = 'sponsor');

CREATE POLICY platform_follower_history_select_own ON public.platform_follower_history
  FOR SELECT USING (creator_id = fn_current_profile_id() OR fn_is_admin());

CREATE POLICY platform_follower_history_sponsor_read ON public.platform_follower_history
  FOR SELECT USING (fn_current_role() = 'sponsor');
