-- 2026-08-20d-creator-rate-cards.sql
--
-- Creator-set, sponsor-visible rate card. Distinct from manager_creator_notes'
-- rate_* columns (2026-08-19b), which are a manager's private CRM notes
-- about what they think a creator should charge -- this is the creator's
-- own stated rate, entered on profile.html (Account Setup tab) and shown
-- publicly on the Verified Media Kit next to the existing auto-generated
-- benchmark estimate in evekit.html, clearly labeled "Creator's stated
-- rate" so sponsors can tell self-reported from estimate.
--
-- Applied live via the Supabase MCP apply_migration tool; this file is
-- the git record.

CREATE TABLE creator_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  deliverable_type text NOT NULL,
  custom_label text,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (deliverable_type <> 'custom' OR custom_label IS NOT NULL)
);

CREATE INDEX idx_creator_rate_cards_creator ON creator_rate_cards(creator_id, sort_order);

ALTER TABLE creator_rate_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "creators manage own rate card" ON creator_rate_cards
  FOR ALL
  USING (creator_id = fn_current_profile_id())
  WITH CHECK (creator_id = fn_current_profile_id());

CREATE POLICY "admins manage all rate cards" ON creator_rate_cards
  FOR ALL
  USING (fn_is_admin());

CREATE TRIGGER trg_creator_rate_cards_updated_at
  BEFORE UPDATE ON creator_rate_cards
  FOR EACH ROW EXECUTE FUNCTION fn_manager_deal_pipeline_touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON creator_rate_cards TO authenticated;

-- fn_get_evekit_profile gains a rate_card jsonb output column. Return type
-- changed, so this required a DROP + CREATE rather than CREATE OR REPLACE.
-- Body is otherwise unchanged from the version this replaces (see
-- supabase/schema-baseline-2026-07-15.sql and the evekit-* migrations that
-- followed it) plus one appended aggregate.
DROP FUNCTION public.fn_get_evekit_profile(text);

CREATE FUNCTION public.fn_get_evekit_profile(p_slug text)
 RETURNS TABLE(display_name text, niche text, location text, bio text, business_email text, avatar_url text, cover_image_url text, gallery_images jsonb, available_for text[], causes text[], theme text, trust_score numeric, confidence numeric, badge_tier text, founding_cohort boolean, reliability_score numeric, verified_campaign_count bigint, profile_views integer, audience_countries jsonb, audience_genders jsonb, audience_ages jsonb, platforms jsonb, campaigns jsonb, collaborations jsonb, press_mentions jsonb, verified_since timestamp with time zone, cover_pattern text, cover_tags text[], cover_spotlight_stat text, avatar_shape text, score_components jsonb, brand_safety_answers jsonb, evidence jsonb, would_hire_again_pct numeric, repeat_sponsor_rate numeric, reputation_ratings jsonb, rate_card jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.display_name, c.niche, c.location, c.bio, c.business_email,
    c.avatar_url, c.cover_image_url, c.gallery_images, c.available_for, c.causes, c.theme,
    c.trust_score, c.confidence::numeric, c.badge_tier, c.founding_cohort,
    c.reliability_score,
    (SELECT count(*) FROM campaigns cam WHERE cam.creator_id = c.id AND cam.creator_confirmed AND cam.sponsor_confirmed),
    c.profile_views,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('label', ad.label, 'pct', ad.pct) ORDER BY ad.pct DESC) FROM audience_demographics ad WHERE ad.creator_id = c.id AND ad.dimension = 'country'), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('label', ad.label, 'pct', ad.pct) ORDER BY ad.pct DESC) FROM audience_demographics ad WHERE ad.creator_id = c.id AND ad.dimension = 'gender'), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('label', ad.label, 'pct', ad.pct) ORDER BY ad.pct DESC) FROM audience_demographics ad WHERE ad.creator_id = c.id AND ad.dimension = 'age'), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('platform', pc.platform, 'platform_handle', pc.platform_handle, 'follower_count', pc.follower_count, 'video_count', pc.video_count, 'view_count', pc.view_count, 'verification_method', pc.verification_method) ORDER BY pc.follower_count DESC NULLS LAST) FROM platform_connections pc WHERE pc.creator_id = c.id AND pc.follower_count IS NOT NULL), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', cam.name, 'objective', cam.objective, 'completed_at', cam.completed_at) ORDER BY cam.created_at DESC) FROM (SELECT * FROM campaigns cam2 WHERE cam2.creator_id = c.id AND cam2.creator_confirmed AND cam2.sponsor_confirmed ORDER BY cam2.created_at DESC LIMIT 6) cam), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('brand_name', cc.brand_name, 'logo_url', cc.logo_url, 'link', cc.link) ORDER BY cc.display_order, cc.created_at) FROM creator_collaborations cc WHERE cc.creator_id = c.id), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', cpm.id, 'title', cpm.title, 'outlet_name', cpm.outlet_name, 'url', cpm.url, 'mention_date', cpm.mention_date) ORDER BY cpm.display_order, cpm.created_at) FROM creator_press_mentions cpm WHERE cpm.creator_id = c.id), '[]'::jsonb),
    (SELECT min(pc.connected_at) FROM platform_connections pc WHERE pc.creator_id = c.id AND pc.verification_method = 'oauth'),
    c.cover_pattern, c.cover_tags, c.cover_spotlight_stat, c.avatar_shape,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('key', sc.component_key, 'label', sc.label, 'value', sc.value, 'status', sc.status) ORDER BY sc.component_key) FROM score_components sc WHERE sc.creator_id = c.id), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('question_key', bsa.question_key, 'answer', bsa.answer)) FROM brand_safety_answers bsa WHERE bsa.creator_id = c.id), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('file_name', eu.file_name, 'evidence_type', eu.evidence_type, 'platform', eu.platform, 'status', eu.status, 'uploaded_at', eu.uploaded_at) ORDER BY eu.uploaded_at DESC) FROM evidence_uploads eu WHERE eu.creator_id = c.id AND eu.status <> 'rejected'), '[]'::jsonb),
    c.would_hire_again_pct, c.repeat_sponsor_rate,
    (SELECT jsonb_build_object(
        'communication', round(avg(cam.communication_rating)::numeric, 1),
        'professionalism', round(avg(cam.professionalism_rating)::numeric, 1),
        'deliverable_quality', round(avg(cam.deliverable_quality_rating)::numeric, 1),
        'would_hire_again_yes', count(*) FILTER (WHERE cam.would_hire_again = true),
        'would_hire_again_total', count(*) FILTER (WHERE cam.would_hire_again IS NOT NULL)
      ) FROM campaigns cam WHERE cam.creator_id = c.id AND cam.creator_confirmed AND cam.sponsor_confirmed),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('deliverable_type', rc.deliverable_type, 'custom_label', rc.custom_label, 'price_cents', rc.price_cents) ORDER BY rc.sort_order, rc.created_at) FROM creator_rate_cards rc WHERE rc.creator_id = c.id), '[]'::jsonb)
  FROM creators c
  JOIN profiles p ON p.id = c.id
  WHERE c.slug = p_slug AND c.is_test = false;
$function$;
