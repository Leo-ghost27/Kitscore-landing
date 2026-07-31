-- 2026-07-31c-reconcile-contract-dispute-columns.sql
--
-- Reconciliation, not a new feature: contracts.disputed_at, dispute_reason,
-- disputed_by, admin_resolved_at, admin_resolution_note already exist live
-- (confirmed via information_schema + a contracts_disputed_by_fkey FK to
-- profiles) but have no matching migration file in git and zero
-- application code anywhere reads or writes them -- a schema-only head
-- start on contract-level dispute tracking that was never built on.
-- Zero rows have them populated. This migration documents what's live
-- (idempotent ADD COLUMN IF NOT EXISTS, so safe to run even though it
-- already exists) so the schema history isn't missing this, and adds one
-- index that becomes useful once app/admin-contracts.html starts filtering
-- on it.
--
-- This is a single-active-dispute-per-contract model (one dispute, one
-- resolution) -- distinct from campaigns' dispute system (status enum +
-- creator/sponsor bounce-back) and from the admin_actions audit log used
-- by escrow/campaign-dispute admin actions. admin-contracts.html uses
-- these columns directly as the flag/resolve mechanism, and also logs to
-- admin_actions for a consistent cross-feature audit trail.
--
-- Applied directly to Supabase (project tpcriphrfrrgywycviqv) via the
-- Supabase MCP apply_migration tool on 2026-07-31; this file is the git
-- record of that change per supabase/README.md's practice.

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS disputed_at timestamptz;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS dispute_reason text;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS disputed_by uuid REFERENCES profiles(id);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS admin_resolved_at timestamptz;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS admin_resolution_note text;

CREATE INDEX IF NOT EXISTS idx_contracts_open_disputes ON contracts (disputed_at)
  WHERE disputed_at IS NOT NULL AND admin_resolved_at IS NULL;
