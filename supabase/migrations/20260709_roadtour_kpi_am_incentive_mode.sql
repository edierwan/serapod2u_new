-- RoadTour KPI — AM incentive calculation mode per plan.
--
-- volume_tiers     = default: monthly scans × RM/scan (system volume brackets)
-- achievement_tiers = optional: custom % of target tiers (manual Add Tier rules)
--
-- Idempotent / additive.

ALTER TABLE public.roadtour_kpi_plans
  ADD COLUMN IF NOT EXISTS am_incentive_mode text NOT NULL DEFAULT 'volume_tiers';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'roadtour_kpi_plans_am_incentive_mode_check'
  ) THEN
    ALTER TABLE public.roadtour_kpi_plans
      ADD CONSTRAINT roadtour_kpi_plans_am_incentive_mode_check
      CHECK (am_incentive_mode IN ('volume_tiers', 'achievement_tiers'));
  END IF;
END $$;

COMMENT ON COLUMN public.roadtour_kpi_plans.am_incentive_mode IS
  'AM incentive model: volume_tiers (scans × RM/scan brackets) or achievement_tiers (custom % of target rules).';
