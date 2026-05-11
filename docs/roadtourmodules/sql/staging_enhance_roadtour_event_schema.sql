-- ============================================================================
-- STAGING: RoadTour Event (roadtour_runs) schema enhancement
-- Run after staging_cleanup_roadtour_transactions.sql.
-- DO NOT RUN ON PRODUCTION.
-- Author: Coder AI, 2026-05-12
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. roadtour_runs (new parent table)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roadtour_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','active','completed','cancelled')),
  duplicate_policy text NOT NULL DEFAULT 'per_run'
                  CHECK (duplicate_policy IN ('per_run','per_campaign','per_day','none')),
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roadtour_runs_dates_ck CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_roadtour_runs_org_status ON public.roadtour_runs (org_id, status);
CREATE INDEX IF NOT EXISTS idx_roadtour_runs_dates     ON public.roadtour_runs (start_date, end_date);

DROP TRIGGER IF EXISTS trg_roadtour_runs_updated_at ON public.roadtour_runs;
CREATE TRIGGER trg_roadtour_runs_updated_at
BEFORE UPDATE ON public.roadtour_runs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_roadtour();

ALTER TABLE public.roadtour_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roadtour_runs_admin_select ON public.roadtour_runs;
CREATE POLICY roadtour_runs_admin_select ON public.roadtour_runs
FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid()
          AND u.role_code IN ('SA','HQ','POWER_USER','HQ_ADMIN','SUPER_ADMIN','ADMIN'))
);

DROP POLICY IF EXISTS roadtour_runs_admin_manage ON public.roadtour_runs;
CREATE POLICY roadtour_runs_admin_manage ON public.roadtour_runs
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid()
          AND u.role_code IN ('SA','HQ','POWER_USER','HQ_ADMIN','SUPER_ADMIN','ADMIN'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid()
          AND u.role_code IN ('SA','HQ','POWER_USER','HQ_ADMIN','SUPER_ADMIN','ADMIN'))
);

-- ----------------------------------------------------------------------------
-- 2. Add roadtour_run_id FK columns to downstream tables.
--    Safe because cleanup script removed all transactional rows.
-- ----------------------------------------------------------------------------

-- 2a. roadtour_campaigns: required parent
ALTER TABLE public.roadtour_campaigns
  ADD COLUMN IF NOT EXISTS roadtour_run_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'roadtour_campaigns_roadtour_run_id_fkey'
  ) THEN
    ALTER TABLE public.roadtour_campaigns
      ADD CONSTRAINT roadtour_campaigns_roadtour_run_id_fkey
      FOREIGN KEY (roadtour_run_id) REFERENCES public.roadtour_runs(id) ON DELETE CASCADE;
  END IF;
END;
$$;

-- Enforce NOT NULL only if no NULL rows remain (post-cleanup)
DO $$
DECLARE
  nulls integer;
BEGIN
  SELECT count(*) INTO nulls FROM public.roadtour_campaigns WHERE roadtour_run_id IS NULL;
  IF nulls = 0 THEN
    ALTER TABLE public.roadtour_campaigns ALTER COLUMN roadtour_run_id SET NOT NULL;
  ELSE
    RAISE NOTICE 'roadtour_campaigns has % rows with NULL roadtour_run_id; leaving column nullable. Backfill required.', nulls;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_roadtour_campaigns_run ON public.roadtour_campaigns (roadtour_run_id);

-- 2b. snapshot columns on downstream tables (nullable; filled by API/triggers)
ALTER TABLE public.roadtour_qr_codes
  ADD COLUMN IF NOT EXISTS roadtour_run_id uuid REFERENCES public.roadtour_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_roadtour_qr_codes_run ON public.roadtour_qr_codes (roadtour_run_id);

ALTER TABLE public.roadtour_scan_events
  ADD COLUMN IF NOT EXISTS roadtour_run_id uuid REFERENCES public.roadtour_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_roadtour_scan_events_run ON public.roadtour_scan_events (roadtour_run_id);

ALTER TABLE public.roadtour_official_visits
  ADD COLUMN IF NOT EXISTS roadtour_run_id uuid REFERENCES public.roadtour_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_roadtour_official_visits_run ON public.roadtour_official_visits (roadtour_run_id);

ALTER TABLE public.roadtour_survey_responses
  ADD COLUMN IF NOT EXISTS roadtour_run_id uuid REFERENCES public.roadtour_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_roadtour_survey_responses_run ON public.roadtour_survey_responses (roadtour_run_id);

ALTER TABLE public.roadtour_claim_notification_logs
  ADD COLUMN IF NOT EXISTS roadtour_run_id uuid REFERENCES public.roadtour_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_roadtour_claim_logs_run ON public.roadtour_claim_notification_logs (roadtour_run_id);

ALTER TABLE public.roadtour_qr_delivery_logs
  ADD COLUMN IF NOT EXISTS roadtour_run_id uuid REFERENCES public.roadtour_runs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_roadtour_qr_delivery_logs_run ON public.roadtour_qr_delivery_logs (roadtour_run_id);

-- ----------------------------------------------------------------------------
-- 3. Trigger: auto-snapshot roadtour_run_id on insert into QR / scan / visit /
--    survey-response / notification / delivery tables, sourced from the parent
--    campaign. This ensures downstream filters/duplicate checks always have the
--    run id even if the API forgets to pass it.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_roadtour_run_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_run uuid;
BEGIN
  IF NEW.roadtour_run_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.campaign_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT roadtour_run_id INTO v_run FROM public.roadtour_campaigns WHERE id = NEW.campaign_id;
  NEW.roadtour_run_id := v_run;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'roadtour_qr_codes',
    'roadtour_scan_events',
    'roadtour_official_visits',
    'roadtour_survey_responses',
    'roadtour_claim_notification_logs',
    'roadtour_qr_delivery_logs'
  ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_run_snapshot ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_run_snapshot BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.snapshot_roadtour_run_id()',
      t, t
    );
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Duplicate protection: one official visit per shop per run.
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.uq_roadtour_official_visit_per_run_shop;
CREATE UNIQUE INDEX uq_roadtour_official_visit_per_run_shop
ON public.roadtour_official_visits (roadtour_run_id, shop_id)
WHERE visit_status = 'official' AND roadtour_run_id IS NOT NULL AND shop_id IS NOT NULL;

COMMIT;

-- ----------------------------------------------------------------------------
-- Verification queries (run separately if desired)
-- ----------------------------------------------------------------------------
\echo '=== Verification ==='
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'roadtour_run_id'
ORDER BY table_name;

SELECT conname, conrelid::regclass AS table
FROM pg_constraint
WHERE conname LIKE '%roadtour_run%' OR conname LIKE 'roadtour_runs_%'
ORDER BY 1;

SELECT indexname FROM pg_indexes
WHERE schemaname = 'public' AND indexname LIKE '%roadtour%run%' OR indexname = 'uq_roadtour_official_visit_per_run_shop'
ORDER BY 1;
