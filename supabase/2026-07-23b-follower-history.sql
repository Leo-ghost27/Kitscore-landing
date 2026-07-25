-- New: platform_follower_history table + capture trigger + fetch RPC.
--
-- Distinct from trust_score_history (which tracks the composite 0-100
-- trust score) -- this tracks raw follower counts per platform over
-- time, which trust_score_history cannot show. Steady incremental growth
-- reads as organic; a sudden jump is the shape purchased-follower fraud
-- typically takes, and a raw follower-count time series is the only way
-- to see that shape at all.
--
-- No historical data existed anywhere before this migration -- the
-- backfill below establishes a single day-one snapshot per existing
-- connection using each connection's *current* follower_count, not
-- fabricated history. Charts will show one point until the next
-- resync adds a second.
--
-- Applied live via Supabase MCP on 2026-07-23, documented here same-day.

CREATE TABLE public.platform_follower_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  creator_id uuid NOT NULL REFERENCES public.creators(id) ON DELETE CASCADE,
  platform text NOT NULL,
  follower_count bigint NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_follower_history_creator ON public.platform_follower_history(creator_id, platform, recorded_at);

-- Same pattern as platform_connections: RLS enabled, no direct client
-- policies -- access only via the SECURITY DEFINER RPC below.
ALTER TABLE public.platform_follower_history ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.fn_capture_follower_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.follower_count IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.follower_count IS DISTINCT FROM OLD.follower_count) THEN
    INSERT INTO platform_follower_history (creator_id, platform, follower_count, recorded_at)
    VALUES (NEW.creator_id, NEW.platform, NEW.follower_count, now());
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_capture_follower_history
  AFTER INSERT OR UPDATE OF follower_count ON public.platform_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_capture_follower_history();

-- Day-one backfill -- current counts only, not fabricated history.
INSERT INTO public.platform_follower_history (creator_id, platform, follower_count, recorded_at)
SELECT creator_id, platform, follower_count, COALESCE(last_synced_at, connected_at, now())
FROM public.platform_connections
WHERE follower_count IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_creator_follower_history(p_creator_id uuid)
 RETURNS TABLE(platform text, follower_count bigint, recorded_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT platform, follower_count, recorded_at
  FROM public.platform_follower_history
  WHERE creator_id = p_creator_id
  ORDER BY platform, recorded_at ASC;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_creator_follower_history(uuid) TO authenticated;
