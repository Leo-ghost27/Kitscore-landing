-- 2026-08-11b, same drift-audit batch as 2026-08-11. Sponsor-side
-- confirmation flows for creator-issued contract invites and campaign
-- confirmation invites -- both magic-link style, security-sensitive.
-- Spot-checked: proper token lookup, expiry enforcement, email-match
-- verification against auth.jwt(), idempotent re-confirmation. No bugs
-- found. No logic changes, pure backfill.

CREATE OR REPLACE FUNCTION public.fn_confirm_contract_invite(p_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invite record;
  v_sponsor_profile record;
  v_auth_email text;
  v_contract_id uuid;
  v_item jsonb;
  v_sort_order integer := 0;
BEGIN
  SELECT * INTO v_invite FROM creator_contract_invites WHERE token = p_token;
  IF v_invite IS NULL THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF v_invite.status = 'accepted' THEN
    RETURN v_invite.created_contract_id;
  END IF;

  IF v_invite.status = 'cancelled' THEN
    RAISE EXCEPTION 'This invite has been cancelled by the creator';
  END IF;

  IF v_invite.expires_at < now() THEN
    UPDATE creator_contract_invites SET status = 'expired' WHERE id = v_invite.id;
    RAISE EXCEPTION 'This invite has expired -- ask the creator to send a new one';
  END IF;

  SELECT p.* INTO v_sponsor_profile
  FROM profiles p
  WHERE p.auth_user_id = auth.uid() AND p.role = 'sponsor';

  IF v_sponsor_profile IS NULL THEN
    RAISE EXCEPTION 'Not authenticated as a sponsor';
  END IF;

  v_auth_email := auth.jwt() ->> 'email';

  IF v_auth_email IS NULL OR lower(v_auth_email) IS DISTINCT FROM lower(v_invite.sponsor_email) THEN
    RAISE EXCEPTION 'This invite was sent to a different email address';
  END IF;

  INSERT INTO contracts (
    creator_id, sponsor_id, title, deliverables, compensation,
    escrow_amount_cents, usage_rights, exclusivity_terms, additional_terms,
    status, created_by
  )
  VALUES (
    v_invite.creator_id, v_sponsor_profile.id, v_invite.title, v_invite.deliverables,
    v_invite.compensation, v_invite.escrow_amount_cents, v_invite.usage_rights,
    v_invite.exclusivity_terms, v_invite.additional_terms, 'sent', v_invite.creator_id
  )
  RETURNING id INTO v_contract_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_invite.deliverable_items)
  LOOP
    INSERT INTO contract_deliverable_items (contract_id, description, quantity, sort_order)
    VALUES (
      v_contract_id,
      v_item ->> 'description',
      COALESCE((v_item ->> 'quantity')::integer, 1),
      v_sort_order
    );
    v_sort_order := v_sort_order + 1;
  END LOOP;

  UPDATE creator_contract_invites
  SET status = 'accepted', accepted_at = now(), created_contract_id = v_contract_id
  WHERE id = v_invite.id;

  RETURN v_contract_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_lookup_contract_invite(p_token uuid)
RETURNS TABLE(status text, sponsor_email text, sponsor_name text, title text, deliverables text, compensation text, escrow_amount_cents integer, creator_display_name text, expires_at timestamp with time zone, created_contract_id uuid, deliverable_items jsonb)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT i.status, i.sponsor_email, i.sponsor_name, i.title, i.deliverables,
         i.compensation, i.escrow_amount_cents, p.display_name, i.expires_at,
         i.created_contract_id, i.deliverable_items
  FROM creator_contract_invites i
  JOIN profiles p ON p.id = i.creator_id
  WHERE i.token = p_token;
$function$;

CREATE OR REPLACE FUNCTION public.fn_confirm_creator_campaign_invite(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_invite record;
  v_creator_profile record;
  v_auth_email text;
  v_campaign_id uuid;
BEGIN
  SELECT * INTO v_invite FROM campaign_confirmation_invites WHERE token = p_token;
  IF v_invite IS NULL THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF v_invite.sponsor_id IS NULL THEN
    RAISE EXCEPTION 'This invite is not a sponsor-to-creator invite';
  END IF;

  IF v_invite.status = 'confirmed' THEN
    RETURN v_invite.campaign_id;
  END IF;

  IF v_invite.expires_at < now() THEN
    UPDATE campaign_confirmation_invites SET status = 'expired' WHERE id = v_invite.id;
    RAISE EXCEPTION 'This invite has expired';
  END IF;

  SELECT p.* INTO v_creator_profile
  FROM profiles p
  WHERE p.auth_user_id = auth.uid() AND p.role = 'creator';

  IF v_creator_profile IS NULL THEN
    RAISE EXCEPTION 'Not authenticated as a creator';
  END IF;

  v_auth_email := auth.jwt() ->> 'email';

  IF v_auth_email IS NULL OR lower(v_auth_email) IS DISTINCT FROM lower(v_invite.creator_email) THEN
    RAISE EXCEPTION 'This invite was sent to a different email address';
  END IF;

  INSERT INTO campaigns (creator_id, sponsor_id, name, creator_confirmed, sponsor_confirmed, status, budget_range, objective, verified_at)
  VALUES (
    v_creator_profile.id,
    v_invite.sponsor_id,
    COALESCE(v_invite.description, 'Confirmed campaign'),
    true, true, 'verified',
    v_invite.budget_range,
    v_invite.description,
    now()
  )
  RETURNING id INTO v_campaign_id;

  UPDATE campaign_confirmation_invites
  SET status = 'confirmed', confirmed_at = now(), campaign_id = v_campaign_id
  WHERE id = v_invite.id;

  RETURN v_campaign_id;
END;
$function$;
