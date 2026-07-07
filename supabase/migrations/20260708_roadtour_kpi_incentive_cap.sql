-- RoadTour Monthly KPI — per-AM incentive cap.
--
-- Adds a dedicated "Max Incentive / AM" column to the KPI team structure so the
-- per-AM monthly incentive cap has an explicit, self-describing home. The older
-- roadtour_kpi_teams.incentive_budget column is intentionally left in place for
-- backward compatibility (the application keeps both columns in sync), so this
-- migration is purely additive and safe to run after the first KPI migration
-- that already shipped to staging and production.
--
-- Idempotent: safe to run multiple times.

-- 1. New column (nullable → no default rewrite needed; NULL = no cap).
ALTER TABLE public.roadtour_kpi_teams
  ADD COLUMN IF NOT EXISTS max_incentive_per_am numeric(12,2);

-- 2. Non-negative guard, added only once.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'roadtour_kpi_teams_max_incentive_per_am_nonneg'
  ) THEN
    ALTER TABLE public.roadtour_kpi_teams
      ADD CONSTRAINT roadtour_kpi_teams_max_incentive_per_am_nonneg
      CHECK (max_incentive_per_am IS NULL OR max_incentive_per_am >= 0);
  END IF;
END $$;

-- 3. Backfill from the legacy incentive_budget so existing teams keep the value
--    they had configured (the field's meaning — a per-AM ceiling — is unchanged
--    in spirit for single-AM/uniform teams). Only touches rows not yet set.
UPDATE public.roadtour_kpi_teams
   SET max_incentive_per_am = incentive_budget
 WHERE max_incentive_per_am IS NULL
   AND incentive_budget IS NOT NULL
   AND incentive_budget > 0;
