-- 2026-08-20-followup-creators-column-privilege-fix.sql
--
-- Same class of bug as managers and sponsors (2026-08-20-followup-*
-- -column-privilege-fix.sql), found extending that review to creators.
-- Worst of the three: this table holds trust_score, reliability_score,
-- badge_tier, repeat_sponsor_rate, would_hire_again_pct, and
-- confidence -- the exact "real verified performance, not
-- self-reported claims" metrics the whole product is built on.
-- creators_update_own RLS only checked row ownership, and column-level
-- GRANT UPDATE underneath was open on every column, to both
-- `authenticated` AND `anon` (RLS blocked anon in practice, revoked
-- anyway -- same pattern as sponsors).
--
-- Also worse in kind, not just degree: stripe_connect_charges_enabled/
-- stripe_connect_payouts_enabled/stripe_connect_details_submitted are
-- payment-readiness flags, and stripe_connect_account_id is the
-- literal destination account for a payout. A creator could have set
-- charges_enabled/payouts_enabled true without ever completing Stripe
-- Connect onboarding, or -- more seriously -- pointed
-- stripe_connect_account_id at a different Stripe account entirely to
-- redirect their own payouts elsewhere. This was live, with no plan or
-- admin gate at all.
--
-- Checked every direct client write (grep across app/*.html) before
-- deciding what to keep: bio, avatar_url, gallery_images,
-- available_for, causes, cover_pattern, avatar_shape, cover_tags,
-- cover_spotlight_stat, theme, niche, location, business_email,
-- availability_status, availability_until are all real, confirmed
-- write paths. profile_views is read-only client-side (incremented
-- elsewhere, likely fn_increment_evekit_view or a service-role
-- process). availability_note and cover_image_url exist as columns
-- but have no write path anywhere in the client at all -- left out,
-- not needed.
--
-- INSERT was equally wide open but unused: no client code anywhere
-- calls sb.from('creators').insert(...) -- account rows are created
-- server-side at signup (handle_new_auth_user or equivalent, running
-- as postgres/service_role, unaffected by revoking from
-- authenticated/anon). Revoked outright rather than narrowed, since
-- nothing depends on it.

REVOKE INSERT, UPDATE ON public.creators FROM authenticated, anon;
GRANT UPDATE (
  bio, avatar_url, gallery_images, available_for, causes, cover_pattern,
  avatar_shape, cover_tags, cover_spotlight_stat, theme, niche, location,
  business_email, availability_status, availability_until, updated_at
) ON public.creators TO authenticated;

-- Verified post-fix: authenticated's UPDATE columns on creators are now
-- exactly the 16 listed above. anon has neither INSERT nor UPDATE.
-- service_role/postgres retain everything, unaffected.
