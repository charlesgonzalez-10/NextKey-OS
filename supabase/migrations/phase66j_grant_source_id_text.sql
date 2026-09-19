-- Phase 66j: Change credit_grants.source_id from uuid to text
--
-- Why: Session 2 business-level idempotency uses Stripe invoice IDs (in_...)
-- as source_id on monthly grants. Stripe invoice IDs are not UUIDs.
-- The column must accept both UUIDs (used for sub.id, purchase.id) and
-- Stripe-format string IDs (in_..., cs_...).
--
-- All existing source_id values are proper UUIDs stored as text — no data loss.

ALTER TABLE credit_grants ALTER COLUMN source_id TYPE text;
