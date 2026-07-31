-- 2026-07-31-admin-oversight-escrow-disputes.sql
--
-- Closes two admin-visibility gaps confirmed absent from both the live
-- schema and docs/admin-roadmap.md (which lists escrow/disputes under
-- neither Shipped nor Proposed -- they were never logged at all):
--
-- 1. Escrow oversight: contracts.escrow_* fields were already readable by
--    admin (contracts_select_involved policy includes fn_is_admin()) and
--    already writable by admin at the DB layer (fn_lock_escrow_fields
--    bypasses for fn_is_admin()) -- but nothing queried them, and no
--    endpoint let admin trigger the real Stripe release/refund. This
--    migration adds the audit trail that the new admin-authed release/
--    refund endpoints (api/escrow.js) write to -- it does not touch
--    escrow logic itself.
-- 2. Dispute arbitration: fn_validate_campaign_confirmation already lets
--    fn_is_admin() bypass the two-party disputed<->pending loop (see the
--    `if fn_is_admin() then return new; end if;` at the top of that
--    function) -- so admin can already force a status change with zero
--    trigger change needed. What's missing is a real terminal outcome:
--    today the only two values are 'pending' and 'verified', so an admin
--    siding against reinstatement has nothing to set except bouncing it
--    back to 'pending', which just re-opens the same two-party loop.
--    Adding 'cancelled' gives arbitration an actual close-out state.
--
-- Applied directly to Supabase (project tpcriphrfrrgywycviqv) via the
-- Supabase MCP apply_migration tool on 2026-07-31; this file is the git
-- record of that change per supabase/README.md's practice.

ALTER TYPE campaign_status ADD VALUE IF NOT EXISTS 'cancelled';

-- Audit trail for every admin override on money-moving or dispute-
-- arbitration actions. No admin override existed anywhere in this schema
-- before now (grepped: zero tables named *_actions, *_audit, *_log
-- targeting admin behavior specifically) -- unacceptable to add
-- admin-forced Stripe transfers/refunds or forced dispute outcomes
-- without one.
CREATE TABLE public.admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES public.profiles(id),
  action_type text NOT NULL,       -- 'escrow_force_release' | 'escrow_force_refund' | 'dispute_resolved_verified' | 'dispute_resolved_cancelled'
  target_table text NOT NULL,      -- 'contracts' | 'campaigns'
  target_id uuid NOT NULL,
  note text NOT NULL,              -- required justification -- no silent overrides, see CHECK below
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_actions_note_not_blank CHECK (btrim(note) <> '')
);

CREATE INDEX idx_admin_actions_target ON public.admin_actions(target_table, target_id);
CREATE INDEX idx_admin_actions_admin ON public.admin_actions(admin_id);

ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

-- Same shape as every other admin-only table in this schema (e.g.
-- admin_flags, brand_safety_scans): fn_is_admin() gates all operations,
-- broad grants to anon/authenticated per this schema's established
-- convention that RLS -- not the grant -- is the real gate.
CREATE POLICY admin_actions_admin_all ON public.admin_actions FOR ALL
  USING (fn_is_admin()) WITH CHECK (fn_is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_actions TO anon, authenticated;
