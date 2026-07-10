-- ============================================================================
-- Return Product Module — add per-case Contact Email
-- ----------------------------------------------------------------------------
-- Additive, backward-compatible migration.
--
-- The Return Product form auto-fills contact details from the selected shop's
-- organization master data (organizations.contact_name / contact_phone /
-- contact_email). This adds a per-return `contact_email` column alongside the
-- existing `contact_person` and `contact_phone` fields so a warehouse/support
-- user can capture (and override) the contact email for a specific return case.
--
-- Nullable, no default, no backfill required. Existing rows are unaffected and
-- the column is safe to add before the UI is deployed.
--
-- Depends on: 20260708_return_product_module_01.sql (creates return_cases).
-- ============================================================================

ALTER TABLE public.return_cases
  ADD COLUMN IF NOT EXISTS contact_email text;
