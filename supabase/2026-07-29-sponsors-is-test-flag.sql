-- 2026-07-29-sponsors-is-test-flag.sql
--
-- creators already has is_test (used to filter seed/demo profiles out
-- of the public EveKit/Verified Media Kit RPC) -- sponsors never got
-- the equivalent column. This surfaced as a real problem: reviewing
-- fn_admin_sponsor_liquidity()'s live output (9 total sponsors, only 3
-- ever confirmed a campaign, 2 active in 30 days) looked like a
-- concerning liquidity/activation problem at first glance. Cross-
-- checking company names and signup dates showed otherwise -- 4 of
-- the 9 (Bloom Beverages, Aura Skincare, NovaTech, StudyPal) all
-- signed up the same day with generic placeholder-style names,
-- consistent with seed/demo data, and 2 more (GHG, Eve Co) are the
-- user's own accounts used to test the sponsor-side flow. That leaves
-- exactly 2 plausible real external sponsors (umo, Ben & Co), both too
-- recently signed up to draw any conclusion from yet.
--
-- Without a flag to exclude the known test/personal accounts, this
-- metric will keep producing a misleadingly alarming headline number
-- indefinitely for anyone who checks it without manually re-doing this
-- same cross-check against company names every time.

ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

-- Backfill the specific rows identified above. Deliberately matching
-- on company_name rather than a blanket date cutoff -- a real sponsor
-- could plausibly have signed up on 2026-06-19 too; matching the
-- specific known seed/personal accounts is safer than assuming
-- everything from that date is test data.
UPDATE sponsors s SET is_test = true
FROM profiles p
WHERE s.id = p.id
  AND s.company_name IN ('Bloom Beverages', 'Aura Skincare', 'NovaTech', 'StudyPal', 'GHG', 'Eve Co');

CREATE OR REPLACE FUNCTION public.fn_admin_sponsor_liquidity()
RETURNS TABLE(total_sponsors bigint, sponsors_with_any_campaign bigint, sponsors_with_confirmed_campaign bigint, sponsors_active_last_30d bigint, ghost_sponsors bigint)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not fn_is_admin() then
    raise exception 'Admin only';
  end if;

  return query
  SELECT
    (SELECT count(*) FROM sponsors sp JOIN profiles p ON p.id = sp.id WHERE p.role = 'sponsor' AND NOT sp.is_test),
    (SELECT count(DISTINCT c.sponsor_id) FROM campaigns c JOIN sponsors sp ON sp.id = c.sponsor_id WHERE c.sponsor_id IS NOT NULL AND NOT sp.is_test),
    (SELECT count(DISTINCT c.sponsor_id) FROM campaigns c JOIN sponsors sp ON sp.id = c.sponsor_id WHERE c.sponsor_id IS NOT NULL AND c.creator_confirmed AND c.sponsor_confirmed AND NOT sp.is_test),
    (SELECT count(DISTINCT c.sponsor_id) FROM campaigns c JOIN sponsors sp ON sp.id = c.sponsor_id WHERE c.sponsor_id IS NOT NULL AND c.created_at > now() - interval '30 days' AND NOT sp.is_test),
    (SELECT count(*) FROM profiles p JOIN sponsors sp ON sp.id = p.id WHERE p.role = 'sponsor' AND NOT sp.is_test
       AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.sponsor_id = p.id));
end;
$function$;
