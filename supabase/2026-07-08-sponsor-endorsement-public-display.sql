-- Feature: sponsor-side feedback on the public profile, not just a
-- confirmed/unconfirmed checkbox. The endorsement data (would_hire_again,
-- endorsement_notes, per-category ratings) already existed and is already
-- submitted via app/campaigns.html — it just never reached the public
-- profile (app/p.html). This migration adds the one missing piece:
-- opt-in consent for showing the sponsor's company name, and a public RPC.
--
-- Design decision (industry-researched): company-name attribution is
-- opt-in, defaulting to anonymous ("Verified sponsor"), matching both
-- Upwork's practice of excluding client identities from public feedback
-- by default, and the general G2/Capterra/Clutch convention where
-- reviewer-company attribution is chosen by the reviewer, not automatic.
-- The note text itself is not gated by this flag — the existing
-- campaigns.html label already told sponsors "shown on the creator's
-- profile" when they wrote it.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS endorsement_public_consent boolean NOT NULL DEFAULT false;

-- Re-create fn_validate_endorsement to include the new column in the
-- protected set, so a write to ONLY endorsement_public_consent still goes
-- through the same sponsor-identity + verified-campaign + one-shot checks
-- as every other endorsement field. Without this, updating just this one
-- column would silently bypass validation entirely.
CREATE OR REPLACE FUNCTION public.fn_validate_endorsement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if fn_is_admin() then
    return new;
  end if;

  if (new.sponsor_rating is distinct from old.sponsor_rating)
     or (new.communication_rating is distinct from old.communication_rating)
     or (new.professionalism_rating is distinct from old.professionalism_rating)
     or (new.deliverable_quality_rating is distinct from old.deliverable_quality_rating)
     or (new.would_hire_again is distinct from old.would_hire_again)
     or (new.endorsement_notes is distinct from old.endorsement_notes)
     or (new.endorsement_public_consent is distinct from old.endorsement_public_consent)
     or (new.endorsement_submitted_at is distinct from old.endorsement_submitted_at) then

    if new.sponsor_id != fn_current_profile_id() then
      raise exception 'Only the sponsor on this campaign can submit an endorsement';
    end if;
    if old.status != 'verified' then
      raise exception 'Endorsements can only be submitted on verified campaigns';
    end if;
    if old.endorsement_submitted_at is not null then
      raise exception 'Endorsement already submitted for this campaign';
    end if;
  end if;

  return new;
end;
$function$;

-- Public RPC: aggregate would-hire-again % + up to 3 most recent notes
-- with notes text, respecting the consent flag for attribution.
-- SECURITY DEFINER + narrow return surface, same pattern as
-- fn_get_public_profile: no sensitive columns (sponsor_id, ratings by
-- individual campaign, dispute fields) are exposed, only what's meant
-- to be public.
CREATE OR REPLACE FUNCTION public.fn_get_public_endorsements(p_slug text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH creator_row AS (
    SELECT c.id FROM creators c WHERE c.slug = p_slug AND c.is_test = false
  ),
  confirmed AS (
    SELECT cam.would_hire_again, cam.endorsement_notes, cam.endorsement_submitted_at,
           cam.endorsement_public_consent, cam.sponsor_id
    FROM campaigns cam, creator_row cr
    WHERE cam.creator_id = cr.id
      AND cam.creator_confirmed AND cam.sponsor_confirmed
      AND cam.endorsement_submitted_at IS NOT NULL
  ),
  agg AS (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE would_hire_again) AS yes_count
    FROM confirmed
  ),
  recent_notes AS (
    SELECT
      CASE WHEN c.endorsement_public_consent THEN p.display_name ELSE 'Verified sponsor' END AS sponsor_label,
      c.endorsement_notes AS note,
      to_char(c.endorsement_submitted_at, 'Mon YYYY') AS submitted_month
    FROM confirmed c
    LEFT JOIN profiles p ON p.id = c.sponsor_id
    WHERE c.endorsement_notes IS NOT NULL AND length(trim(c.endorsement_notes)) > 0
    ORDER BY c.endorsement_submitted_at DESC
    LIMIT 3
  )
  SELECT jsonb_build_object(
    'total_endorsements', COALESCE((SELECT total FROM agg), 0),
    'would_hire_again_pct', CASE WHEN (SELECT total FROM agg) > 0
       THEN round((SELECT yes_count FROM agg)::numeric / (SELECT total FROM agg) * 100)
       ELSE null END,
    'notes', COALESCE((SELECT jsonb_agg(row_to_json(recent_notes)) FROM recent_notes), '[]'::jsonb)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.fn_get_public_endorsements(text) TO anon, authenticated;
