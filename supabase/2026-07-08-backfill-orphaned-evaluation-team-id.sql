-- 2026-07-08-backfill-orphaned-evaluation-team-id.sql
--
-- Found via live testing: GHG's own June 25 evaluation of Aaliya Ahmed
-- (predates the team, created June 30, and the team_id-tagging feature,
-- shipped July 7) had team_id NULL -- so the Client card and approval
-- workflow never appeared for it, even though GHG is currently the
-- team's owner. Checked how widespread this is before assuming it was
-- isolated: 15 evaluations across the database belong to a sponsor who
-- is CURRENTLY on a team but whose evaluation predates that membership
-- (or predates the tagging feature entirely) and was never backfilled.
--
-- The self-healing fix already shipped in api/generate-evaluation.js
-- (2026-07-08, "Fix two real bugs...") can't reach these: it only runs
-- when the Unlock button is clicked, and that button is gone forever
-- once an evaluation is already unlocked -- "Download PDF" replaces it
-- with no path back through that endpoint. A one-time backfill is the
-- only way to close the gap for evaluations already in this state.
--
-- Attribution is based on CURRENT team_members membership. This app's
-- model treats team membership as at most one team per sponsor
-- (every membership lookup in the codebase uses .maybeSingle()), so
-- there's no "which of several teams" ambiguity to worry about here.

UPDATE evaluations e
SET team_id = tm.team_id,
    approval_status = COALESCE(e.approval_status, 'draft')
FROM team_members tm
WHERE tm.sponsor_id = e.sponsor_id
  AND e.team_id IS NULL;
