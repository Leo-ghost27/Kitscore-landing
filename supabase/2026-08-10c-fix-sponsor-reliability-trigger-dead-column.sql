-- Pre-launch audit, 2026-08-10: the persisted sponsors.reliability_score /
-- payment_reliability (shown to admins in app/admin-sponsors.html) never
-- actually updated after a creator submitted a "Rate this sponsor" rating.
--
-- Root cause: trg_sponsor_reliability_on_creator_rating watched
-- creator_endorsement_submitted_at, but the real, shipped rating form
-- (submitSponsorRating() in app/campaigns.html) writes to a different
-- column entirely: creator_rating_submitted_at. Nothing in the app ever
-- sets creator_endorsement_submitted_at, so this trigger has never fired
-- from real user activity. The only trigger that ever ran
-- (trg_sponsor_reliability_on_campaign, on mutual confirmation) fires
-- BEFORE a rating exists, so every sponsor's persisted score was frozen
-- at a pure campaign-volume number the moment they hit 2 confirmed
-- campaigns, and never incorporated any actual creator rating or
-- outcome after that.
--
-- Not a risk to creators today: app/briefs.html (where this matters for
-- protection -- shown before a creator applies to a brief) reads live
-- from fn_sponsor_reliability() directly, which was always correct and
-- never depended on this broken trigger. This fix specifically corrects
-- what admins see in app/admin-sponsors.html, and makes the persisted
-- score usable for future features built directly against
-- sponsors.reliability_score / payment_reliability.
--
-- recalculate_sponsor_reliability() itself was already correct -- it
-- reads creator_rating, the real column. Only the trigger watching the
-- wrong column needed fixing.
--
-- Applied live via Supabase MCP on 2026-08-10, then backfilled with:
--   do $$ declare r record; begin
--     for r in select id from sponsors loop
--       perform recalculate_sponsor_reliability(r.id);
--     end loop;
--   end $$;

CREATE OR REPLACE FUNCTION public.trg_sponsor_reliability_on_creator_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.creator_rating_submitted_at IS NOT NULL
     AND OLD.creator_rating_submitted_at IS NULL THEN
    PERFORM recalculate_sponsor_reliability(NEW.sponsor_id);
  END IF;
  RETURN NEW;
END;
$function$;
