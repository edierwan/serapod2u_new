-- ============================================================================
-- Migration: RoadTour KPI PLAN refinement
-- Date: 2026-07-07
--
-- Purpose
--   The first KPI migration (20260707_roadtour_monthly_kpi.sql) modelled KPI as a
--   per-month "cycle" that an admin had to create every calendar month. That is
--   confusing for users. This migration introduces a durable **KPI Plan**:
--
--     * A KPI Plan is created ONCE per RoadTour Event.
--     * It has an effective_from_month and an optional effective_to_month.
--     * Monthly reports are generated automatically for any month inside that
--       effective window — no manual monthly cycle creation is required.
--     * roadtour_kpi_cycles is retained as the internal per-plan configuration
--       snapshot (teams / members / incentive rules still hang off a cycle),
--       hidden from the user behind the Plan concept.
--
-- Safety / idempotency
--   * 100% additive. No table is dropped. No column is dropped or retyped.
--   * All statements use IF NOT EXISTS / CREATE OR REPLACE / guarded DO blocks,
--     so it is safe to run on environments where the first KPI migration has
--     already been applied AND on environments where the KPI tables are empty
--     (production today) or already contain data (staging).
--   * Re-runnable: running this file twice is a no-op.
--
-- Manual run only — do NOT execute automatically. Apply via the usual Supabase
-- migration process.
-- ============================================================================

-- ============================================================================
-- 0. RLS HELPER (idempotent — same definition used by the first KPI migration;
--    recreated so this file is self-contained on environments missing it).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_roadtour_org_admin(target_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND (
        u.role_code IN ('SA', 'HQ', 'HQ_ADMIN', 'SUPER_ADMIN')
        OR (
          u.role_code IN ('POWER_USER', 'ADMIN')
          AND u.organization_id IS NOT DISTINCT FROM target_org_id
        )
      )
  );
$$;

-- ============================================================================
-- A. KPI PLANS
--    One durable plan per org + event. effective_from_month / effective_to_month
--    are always the first day of the calendar month (or NULL for open-ended).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_kpi_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  roadtour_run_id uuid NOT NULL REFERENCES public.roadtour_runs(id) ON DELETE CASCADE,
  plan_name text,
  effective_from_month date NOT NULL,             -- first day of the start month
  effective_to_month date,                        -- first day of the end month, NULL = open-ended
  reporting_scope text NOT NULL DEFAULT 'all_campaigns'
    CHECK (reporting_scope IN ('all_campaigns', 'selected_campaigns')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  leader_bonus_enabled boolean NOT NULL DEFAULT false,
  -- The cycle that stores this plan's team/member/incentive configuration. The
  -- monthly report reuses this configuration for every month in the effective
  -- window. Nullable so the plan row can be created before its config cycle.
  config_cycle_id uuid REFERENCES public.roadtour_kpi_cycles(id) ON DELETE SET NULL,
  activated_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_roadtour_kpi_plan_from_first_day
    CHECK (effective_from_month = date_trunc('month', effective_from_month)::date),
  CONSTRAINT chk_roadtour_kpi_plan_to_first_day
    CHECK (effective_to_month IS NULL OR effective_to_month = date_trunc('month', effective_to_month)::date),
  CONSTRAINT chk_roadtour_kpi_plan_range
    CHECK (effective_to_month IS NULL OR effective_to_month >= effective_from_month)
);

CREATE INDEX IF NOT EXISTS idx_roadtour_kpi_plans_org_run
  ON public.roadtour_kpi_plans (org_id, roadtour_run_id);
CREATE INDEX IF NOT EXISTS idx_roadtour_kpi_plans_run_status
  ON public.roadtour_kpi_plans (roadtour_run_id, status);

-- At most one non-archived (draft or active) plan per event, so the UI never has
-- to disambiguate which plan owns "this month". Historical plans are archived.
CREATE UNIQUE INDEX IF NOT EXISTS uq_roadtour_kpi_plan_live_per_event
  ON public.roadtour_kpi_plans (org_id, roadtour_run_id)
  WHERE status IN ('draft', 'active');

-- ============================================================================
-- B. LINK EXISTING CYCLES TO A PLAN (additive column on the existing table)
--    Cycles created by the plan flow carry their owning plan id. Legacy
--    standalone cycles simply keep NULL and continue to work unchanged.
-- ============================================================================
ALTER TABLE public.roadtour_kpi_cycles
  ADD COLUMN IF NOT EXISTS kpi_plan_id uuid REFERENCES public.roadtour_kpi_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_roadtour_kpi_cycles_plan
  ON public.roadtour_kpi_cycles (kpi_plan_id);

-- ============================================================================
-- C. updated_at TRIGGER for plans (reuse existing RoadTour helper)
-- ============================================================================
DO $$
BEGIN
  IF to_regprocedure('public.set_updated_at_roadtour()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_roadtour_kpi_plans_updated_at ON public.roadtour_kpi_plans';
    EXECUTE 'CREATE TRIGGER trg_roadtour_kpi_plans_updated_at BEFORE UPDATE ON public.roadtour_kpi_plans '
         || 'FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_roadtour()';
  END IF;
END $$;

-- ============================================================================
-- D. ROW LEVEL SECURITY (org-scoped admin, same pattern as other KPI tables)
-- ============================================================================
ALTER TABLE public.roadtour_kpi_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roadtour_kpi_plans_admin_manage ON public.roadtour_kpi_plans;
CREATE POLICY roadtour_kpi_plans_admin_manage
ON public.roadtour_kpi_plans
FOR ALL
USING (public.is_roadtour_org_admin(org_id))
WITH CHECK (public.is_roadtour_org_admin(org_id));

-- ============================================================================
-- E. BACKFILL (optional, safe): adopt any pre-existing standalone cycles into a
--    plan so historical staging data keeps reporting. Only runs when cycles
--    exist that are not yet linked to a plan. No-op on empty production tables.
--    One plan per (org, run); effective_from = earliest cycle month; the most
--    recent cycle becomes the config cycle.
-- ============================================================================
DO $$
DECLARE
  rec record;
  new_plan_id uuid;
  cfg_cycle_id uuid;
BEGIN
  FOR rec IN
    SELECT org_id, roadtour_run_id,
           min(kpi_month) AS from_month,
           bool_or(status = 'active') AS any_active
    FROM public.roadtour_kpi_cycles
    WHERE kpi_plan_id IS NULL
    GROUP BY org_id, roadtour_run_id
  LOOP
    -- Skip if a live plan already exists for this event (idempotent re-runs).
    IF EXISTS (
      SELECT 1 FROM public.roadtour_kpi_plans p
      WHERE p.org_id = rec.org_id
        AND p.roadtour_run_id = rec.roadtour_run_id
        AND p.status IN ('draft', 'active')
    ) THEN
      CONTINUE;
    END IF;

    SELECT id INTO cfg_cycle_id
    FROM public.roadtour_kpi_cycles
    WHERE org_id = rec.org_id AND roadtour_run_id = rec.roadtour_run_id AND kpi_plan_id IS NULL
    ORDER BY kpi_month DESC
    LIMIT 1;

    INSERT INTO public.roadtour_kpi_plans (
      org_id, roadtour_run_id, effective_from_month, effective_to_month,
      status, leader_bonus_enabled, config_cycle_id, activated_at
    ) VALUES (
      rec.org_id, rec.roadtour_run_id, rec.from_month, NULL,
      CASE WHEN rec.any_active THEN 'active' ELSE 'draft' END,
      -- Enable leader bonus if any existing team_leader incentive rule is present.
      EXISTS (
        SELECT 1 FROM public.roadtour_kpi_incentive_rules r
        JOIN public.roadtour_kpi_cycles c ON c.id = r.kpi_cycle_id
        WHERE c.org_id = rec.org_id AND c.roadtour_run_id = rec.roadtour_run_id
          AND r.applies_to = 'team_leader' AND r.status = 'active'
      ),
      cfg_cycle_id,
      CASE WHEN rec.any_active THEN now() ELSE NULL END
    )
    RETURNING id INTO new_plan_id;

    UPDATE public.roadtour_kpi_cycles
    SET kpi_plan_id = new_plan_id
    WHERE org_id = rec.org_id AND roadtour_run_id = rec.roadtour_run_id AND kpi_plan_id IS NULL;
  END LOOP;
END $$;

-- ============================================================================
-- F. DOCUMENTATION COMMENTS
-- ============================================================================
COMMENT ON TABLE public.roadtour_kpi_plans IS
  'Durable per-event KPI plan. Created once; monthly reports auto-derive from its config cycle across effective_from_month..effective_to_month.';
COMMENT ON COLUMN public.roadtour_kpi_plans.effective_from_month IS 'First calendar month (first day) the plan applies to.';
COMMENT ON COLUMN public.roadtour_kpi_plans.effective_to_month IS 'Last calendar month (first day) the plan applies to, or NULL for open-ended.';
COMMENT ON COLUMN public.roadtour_kpi_plans.leader_bonus_enabled IS 'When true, team_leader incentive rules pay an additive bonus on top of the leader''s own AM incentive.';
COMMENT ON COLUMN public.roadtour_kpi_plans.config_cycle_id IS 'Cycle holding this plan''s team/member/incentive configuration, reused for every month in the effective window.';
COMMENT ON COLUMN public.roadtour_kpi_cycles.kpi_plan_id IS 'Owning KPI plan (NULL for legacy standalone cycles).';
