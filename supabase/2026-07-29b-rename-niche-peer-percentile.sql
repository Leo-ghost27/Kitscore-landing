-- Documents a rename that already happened live, done via raw SQL by
-- another session with zero trace anywhere -- not in git, not in
-- Supabase's own supabase_migrations.schema_migrations ledger. Confirmed
-- by comparing pg_proc definitions: fn_niche_peer_percentile is a
-- byte-for-byte identical body to fn_niche_engagement_benchmark (same
-- MIN_COHORT_SIZE=5 guard, same logic), just under a new name that fits
-- the naming convention of fn_niche_engagement_mult (the sibling
-- niche-difficulty-multiplier function shipped the same day). Not a
-- competing reimplementation -- the other session kept this function
-- and renamed it, rather than discarding it.
--
-- Written defensively so it's a safe no-op if run again: only renames
-- if the old name still exists.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'fn_niche_engagement_benchmark' AND pronamespace = 'public'::regnamespace
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'fn_niche_peer_percentile' AND pronamespace = 'public'::regnamespace
  ) THEN
    ALTER FUNCTION public.fn_niche_engagement_benchmark(uuid, text) RENAME TO fn_niche_peer_percentile;
  END IF;
END $$;
