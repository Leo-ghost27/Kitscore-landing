-- Feature: evidence freshness nudges. The Evidence page already tells
-- creators "add fresh analytics every 90 days" but nothing tracks or
-- enforces it. This adds the tracking column; the 90-day staleness
-- threshold itself is computed client-side from the existing uploaded_at
-- column (no need for a separate expiry column), and this
-- last_expiry_nudge_sent_at timestamp prevents the reminder email from
-- being re-sent every time the nudge script runs (see
-- scripts/send-evidence-expiry-nudges.js) — at most one nudge per
-- creator per ~30 days, following the same manually-run-script pattern
-- as scripts/retry-failed-notifications.js.

ALTER TABLE public.evidence_uploads
  ADD COLUMN IF NOT EXISTS last_expiry_nudge_sent_at timestamptz;
