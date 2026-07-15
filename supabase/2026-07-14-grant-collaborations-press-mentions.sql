-- creator_collaborations / creator_press_mentions (added in
-- add_collaborations_press_available_for) had correct RLS policies but,
-- same class of bug as audience_demographics earlier today
-- (2026-07-14-audience-demographics-breakdown.sql): RLS policies alone
-- don't grant access in Postgres -- the authenticated role also needs
-- the base table-level GRANT, which was never issued for these two
-- tables. Caught and fixed directly in production before the frontend
-- (profile.html "Past collaborations" section) shipped, so this never
-- actually blocked a live save the way the audience_demographics one did.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creator_collaborations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.creator_press_mentions TO authenticated;
