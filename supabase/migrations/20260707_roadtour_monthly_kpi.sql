-- ============================================================================
-- Migration: RoadTour Monthly KPI & Incentive tracking
-- Date: 2026-07-07
--
-- Adds monthly KPI cycle configuration for RoadTour Events:
-- 1. roadtour_kpi_cycles          — one cycle per org + event + calendar month.
-- 2. roadtour_kpi_teams           — team structure (name, leader, monthly target).
-- 3. roadtour_kpi_team_members    — AM membership with auto/manual scan targets.
-- 4. roadtour_kpi_incentive_rules — configurable incentive tiers per cycle.
--
-- Attribution note: roadtour_scan_events already snapshots campaign_id,
-- account_manager_user_id and roadtour_run_id at scan time (see
-- trg_roadtour_scan_events_run_snapshot). Historical scans are never
-- rewritten, so no changes to the scan table are required here.
-- ============================================================================

-- ============================================================================
-- 0. RLS HELPER (idempotent — same definition as 20260510 hardening migration;
--    recreated here because some environments do not have it applied yet)
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
-- A. KPI CYCLES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_kpi_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  roadtour_run_id uuid NOT NULL REFERENCES public.roadtour_runs(id) ON DELETE CASCADE,
  kpi_month date NOT NULL,  -- always the first day of the calendar month
  period_start date NOT NULL,
  period_end date NOT NULL,
  reporting_scope text NOT NULL DEFAULT 'all_campaigns' CHECK (reporting_scope IN ('all_campaigns', 'selected_campaigns')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  freeze_members_targets boolean NOT NULL DEFAULT true,
  lock_campaign_qr_attribution boolean NOT NULL DEFAULT true,
  activated_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_roadtour_kpi_cycles_month_first_day CHECK (kpi_month = date_trunc('month', kpi_month)::date),
  CONSTRAINT chk_roadtour_kpi_cycles_period CHECK (period_start <= period_end),
  CONSTRAINT uq_roadtour_kpi_cycle_month UNIQUE (org_id, roadtour_run_id, kpi_month)
);

CREATE INDEX IF NOT EXISTS idx_roadtour_kpi_cycles_org_month ON public.roadtour_kpi_cycles (org_id, kpi_month DESC);
CREATE INDEX IF NOT EXISTS idx_roadtour_kpi_cycles_run ON public.roadtour_kpi_cycles (roadtour_run_id, status);

-- ============================================================================
-- B. KPI TEAMS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_kpi_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kpi_cycle_id uuid NOT NULL REFERENCES public.roadtour_kpi_cycles(id) ON DELETE CASCADE,
  team_name text NOT NULL,
  leader_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  monthly_team_target integer NOT NULL DEFAULT 0 CHECK (monthly_team_target >= 0),
  incentive_budget numeric(12,2) NOT NULL DEFAULT 0 CHECK (incentive_budget >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_roadtour_kpi_team_name UNIQUE (kpi_cycle_id, team_name)
);

CREATE INDEX IF NOT EXISTS idx_roadtour_kpi_teams_cycle ON public.roadtour_kpi_teams (kpi_cycle_id);
CREATE INDEX IF NOT EXISTS idx_roadtour_kpi_teams_org ON public.roadtour_kpi_teams (org_id);

-- ============================================================================
-- C. KPI TEAM MEMBERS (one AM belongs to at most one team per cycle)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_kpi_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kpi_cycle_id uuid NOT NULL REFERENCES public.roadtour_kpi_cycles(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.roadtour_kpi_teams(id) ON DELETE CASCADE,
  am_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  auto_target_scans integer NOT NULL DEFAULT 0 CHECK (auto_target_scans >= 0),
  manual_target_scans integer CHECK (manual_target_scans IS NULL OR manual_target_scans >= 0),
  target_source text NOT NULL DEFAULT 'auto' CHECK (target_source IN ('auto', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_roadtour_kpi_member_per_cycle UNIQUE (kpi_cycle_id, am_user_id)
);

CREATE INDEX IF NOT EXISTS idx_roadtour_kpi_members_team ON public.roadtour_kpi_team_members (team_id);
CREATE INDEX IF NOT EXISTS idx_roadtour_kpi_members_cycle ON public.roadtour_kpi_team_members (kpi_cycle_id);
CREATE INDEX IF NOT EXISTS idx_roadtour_kpi_members_am ON public.roadtour_kpi_team_members (am_user_id);

-- ============================================================================
-- D. KPI INCENTIVE RULES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_kpi_incentive_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kpi_cycle_id uuid NOT NULL REFERENCES public.roadtour_kpi_cycles(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.roadtour_kpi_teams(id) ON DELETE CASCADE,
  rule_name text NOT NULL,
  applies_to text NOT NULL DEFAULT 'all_ams' CHECK (applies_to IN ('all_ams', 'team_leader', 'specific_team')),
  achievement_threshold_percent numeric(6,2) NOT NULL CHECK (achievement_threshold_percent > 0),
  incentive_amount numeric(12,2) NOT NULL CHECK (incentive_amount >= 0),
  bonus_type text NOT NULL DEFAULT 'cash' CHECK (bonus_type IN ('cash', 'other')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_roadtour_kpi_rule_team_scope CHECK (applies_to <> 'specific_team' OR team_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_roadtour_kpi_rules_cycle ON public.roadtour_kpi_incentive_rules (kpi_cycle_id, status);

-- ============================================================================
-- E. updated_at TRIGGERS (reuse existing RoadTour helper)
-- ============================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roadtour_kpi_cycles', 'roadtour_kpi_teams', 'roadtour_kpi_incentive_rules']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_roadtour()',
      t, t
    );
  END LOOP;
END $$;

-- ============================================================================
-- F. ROW LEVEL SECURITY (org-scoped admin, same pattern as other RoadTour tables)
-- ============================================================================
ALTER TABLE public.roadtour_kpi_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadtour_kpi_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadtour_kpi_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadtour_kpi_incentive_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roadtour_kpi_cycles_admin_manage ON public.roadtour_kpi_cycles;
CREATE POLICY roadtour_kpi_cycles_admin_manage
ON public.roadtour_kpi_cycles
FOR ALL
USING (public.is_roadtour_org_admin(org_id))
WITH CHECK (public.is_roadtour_org_admin(org_id));

DROP POLICY IF EXISTS roadtour_kpi_teams_admin_manage ON public.roadtour_kpi_teams;
CREATE POLICY roadtour_kpi_teams_admin_manage
ON public.roadtour_kpi_teams
FOR ALL
USING (public.is_roadtour_org_admin(org_id))
WITH CHECK (public.is_roadtour_org_admin(org_id));

DROP POLICY IF EXISTS roadtour_kpi_team_members_admin_manage ON public.roadtour_kpi_team_members;
CREATE POLICY roadtour_kpi_team_members_admin_manage
ON public.roadtour_kpi_team_members
FOR ALL
USING (public.is_roadtour_org_admin(org_id))
WITH CHECK (public.is_roadtour_org_admin(org_id));

DROP POLICY IF EXISTS roadtour_kpi_incentive_rules_admin_manage ON public.roadtour_kpi_incentive_rules;
CREATE POLICY roadtour_kpi_incentive_rules_admin_manage
ON public.roadtour_kpi_incentive_rules
FOR ALL
USING (public.is_roadtour_org_admin(org_id))
WITH CHECK (public.is_roadtour_org_admin(org_id));

-- AMs can read their own team membership rows (for future self-service views).
DROP POLICY IF EXISTS roadtour_kpi_team_members_self_select ON public.roadtour_kpi_team_members;
CREATE POLICY roadtour_kpi_team_members_self_select
ON public.roadtour_kpi_team_members
FOR SELECT
USING (am_user_id = auth.uid());
