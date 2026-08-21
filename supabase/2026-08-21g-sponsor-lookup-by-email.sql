-- 2026-08-21g-sponsor-lookup-by-email.sql
--
-- Lets a creator, before inviting a sponsor into their own bring-your-own
-- deal (contracts.html), check whether that email belongs to an existing
-- Kitscore sponsor account and if so see their real reliability record --
-- the same fn_sponsor_reliability data already shown on briefs.html next
-- to open listings, just made reachable here too, since a creator
-- bringing their own deal never sees that page. An unmatched email, or a
-- matched account with no deal history yet, gets a protective nudge
-- instead on the frontend (milestone escrow, run the clause scan) rather
-- than a rating that doesn't exist.
--
-- Applied live via the Supabase MCP apply_migration tool; this file is
-- the git record.

CREATE FUNCTION public.fn_lookup_sponsor_by_email(p_email text)
RETURNS TABLE(sponsor_id uuid, company_name text, sample_size integer, avg_rating numeric, ghosted_count integer, never_booked_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select
    s.id,
    s.company_name,
    coalesce(r.sample_size, 0),
    r.avg_rating,
    coalesce(r.ghosted_count, 0),
    coalesce(r.never_booked_count, 0)
  from profiles p
  join sponsors s on s.id = p.id
  left join lateral fn_sponsor_reliability(s.id) r on true
  where lower(p.email) = lower(trim(p_email))
    and p.role = 'sponsor'
  limit 1;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_lookup_sponsor_by_email(text) TO authenticated;
