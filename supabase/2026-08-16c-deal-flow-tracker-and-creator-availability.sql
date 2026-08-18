-- 2026-08-16c-deal-flow-tracker-and-creator-availability.sql
--
-- Two new creator-side features, applied live via the Supabase MCP
-- apply_migration tool; this file is the git record of that change.
--
-- 1. AVAILABILITY: plain columns on creators (1:1, no history needed).
--    Shown as a badge on directory.html cards for sponsors; edited from
--    profile.html's hero on the creator side. Null status = not set,
--    badge doesn't render (no forced opinion for creators who haven't
--    used this yet).
--
-- 2. DEAL FLOW TRACKER: a lightweight personal CRM for outreach that
--    hasn't (and may never) become a formal Kitscore campaign/contract.
--    Entirely creator-owned, no sponsor visibility at all -- this is
--    scratch space, not a claim about a real deal the way
--    contracts/campaigns are, so it deliberately has none of the
--    verification/escrow/dispute machinery those tables carry.

-- ---------- Availability ----------
ALTER TABLE creators ADD COLUMN IF NOT EXISTS availability_status text CHECK (availability_status IS NULL OR availability_status = ANY (ARRAY['open'::text, 'limited'::text, 'booked'::text]));
ALTER TABLE creators ADD COLUMN IF NOT EXISTS availability_note text;
ALTER TABLE creators ADD COLUMN IF NOT EXISTS availability_until date;

-- No new RLS needed: creators_update_own already permits creators to
-- update their own row with no column allowlist, and creators has no
-- lock-list trigger (unlike contracts' fn_validate_contract_changes)
-- that would need extending for these new columns. Confirmed via
-- pg_trigger before writing this migration.

-- ---------- Deal Flow Tracker ----------
CREATE TABLE deal_flow_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  brand_name text NOT NULL,
  contact_name text,
  contact_email text,
  stage text NOT NULL DEFAULT 'reached_out' CHECK (stage = ANY (ARRAY['reached_out'::text, 'responded'::text, 'negotiating'::text, 'closed_won'::text, 'closed_lost'::text])),
  estimated_value_cents integer,
  notes text,
  next_follow_up_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_deal_flow_entries_creator ON deal_flow_entries(creator_id);

ALTER TABLE deal_flow_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "creators manage their own deal flow entries" ON deal_flow_entries
  FOR ALL
  USING (creator_id = fn_current_profile_id())
  WITH CHECK (creator_id = fn_current_profile_id());

CREATE POLICY "admins manage all deal flow entries" ON deal_flow_entries
  FOR ALL
  USING (fn_is_admin());

-- No generic "touch updated_at" helper exists in this schema (checked
-- before writing this -- other tables either skip updated_at or set it
-- inline inside a bespoke trigger like fn_validate_contract_changes
-- does for contracts). Bespoke trigger function for this table, same
-- pattern.
CREATE OR REPLACE FUNCTION fn_deal_flow_entries_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE TRIGGER trg_deal_flow_entries_updated_at
  BEFORE UPDATE ON deal_flow_entries
  FOR EACH ROW EXECUTE FUNCTION fn_deal_flow_entries_touch_updated_at();
