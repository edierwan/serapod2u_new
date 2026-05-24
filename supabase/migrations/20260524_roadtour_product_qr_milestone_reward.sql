-- ============================================================
-- RoadTour Product QR Milestone Reward
-- Date: 2026-05-24
-- Scope: staging-safe additive schema + RPC support
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Current Event-level release rule fields on roadtour_runs
-- ============================================================
ALTER TABLE public.roadtour_runs
  ADD COLUMN IF NOT EXISTS point_release_rule text NOT NULL DEFAULT 'immediate_after_roadtour_claim',
  ADD COLUMN IF NOT EXISTS required_product_qr_scans integer,
  ADD COLUMN IF NOT EXISTS product_qr_counting_period text,
  ADD COLUMN IF NOT EXISTS unique_product_qr_only boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS active_reward_rule_version_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'roadtour_runs_point_release_rule_check'
      AND conrelid = 'public.roadtour_runs'::regclass
  ) THEN
    ALTER TABLE public.roadtour_runs
      ADD CONSTRAINT roadtour_runs_point_release_rule_check
      CHECK (point_release_rule IN ('immediate_after_roadtour_claim', 'product_qr_scan_target_once'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'roadtour_runs_product_qr_counting_period_check'
      AND conrelid = 'public.roadtour_runs'::regclass
  ) THEN
    ALTER TABLE public.roadtour_runs
      ADD CONSTRAINT roadtour_runs_product_qr_counting_period_check
      CHECK (
        product_qr_counting_period IS NULL
        OR product_qr_counting_period IN ('rolling_1_month', 'rolling_2_months', 'open_period')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'roadtour_runs_product_qr_rule_shape_check'
      AND conrelid = 'public.roadtour_runs'::regclass
  ) THEN
    ALTER TABLE public.roadtour_runs
      ADD CONSTRAINT roadtour_runs_product_qr_rule_shape_check
      CHECK (
        point_release_rule = 'immediate_after_roadtour_claim'
        OR (
          point_release_rule = 'product_qr_scan_target_once'
          AND required_product_qr_scans IS NOT NULL
          AND required_product_qr_scans >= 1
          AND product_qr_counting_period IS NOT NULL
          AND unique_product_qr_only = true
        )
      );
  END IF;
END $$;

-- ============================================================
-- 2. Immutable Event rule versions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.roadtour_event_reward_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadtour_event_id uuid NOT NULL REFERENCES public.roadtour_runs(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'superseded', 'retired')),
  point_release_rule text NOT NULL CHECK (point_release_rule IN ('immediate_after_roadtour_claim', 'product_qr_scan_target_once')),
  required_product_qr_scans integer,
  product_qr_counting_period text CHECK (
    product_qr_counting_period IS NULL
    OR product_qr_counting_period IN ('rolling_1_month', 'rolling_2_months', 'open_period')
  ),
  unique_product_qr_only boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  change_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT roadtour_event_reward_rule_versions_shape_check CHECK (
    point_release_rule = 'immediate_after_roadtour_claim'
    OR (
      point_release_rule = 'product_qr_scan_target_once'
      AND required_product_qr_scans IS NOT NULL
      AND required_product_qr_scans >= 1
      AND product_qr_counting_period IS NOT NULL
      AND unique_product_qr_only = true
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_roadtour_event_reward_rule_versions_no
  ON public.roadtour_event_reward_rule_versions (roadtour_event_id, version_no);

CREATE UNIQUE INDEX IF NOT EXISTS uq_roadtour_event_reward_rule_versions_active
  ON public.roadtour_event_reward_rule_versions (roadtour_event_id)
  WHERE status = 'active' AND effective_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_roadtour_event_reward_rule_versions_event
  ON public.roadtour_event_reward_rule_versions (roadtour_event_id, status, effective_from DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'roadtour_runs_active_reward_rule_version_id_fkey'
      AND conrelid = 'public.roadtour_runs'::regclass
  ) THEN
    ALTER TABLE public.roadtour_runs
      ADD CONSTRAINT roadtour_runs_active_reward_rule_version_id_fkey
      FOREIGN KEY (active_reward_rule_version_id)
      REFERENCES public.roadtour_event_reward_rule_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill default immediate rule versions for existing Events.
WITH inserted AS (
  INSERT INTO public.roadtour_event_reward_rule_versions (
    roadtour_event_id,
    version_no,
    status,
    point_release_rule,
    required_product_qr_scans,
    product_qr_counting_period,
    unique_product_qr_only,
    effective_from,
    created_by,
    metadata
  )
  SELECT
    r.id,
    1,
    'active',
    r.point_release_rule,
    r.required_product_qr_scans,
    r.product_qr_counting_period,
    COALESCE(r.unique_product_qr_only, true),
    COALESCE(r.created_at, now()),
    r.created_by,
    jsonb_build_object('source', '20260524_backfill')
  FROM public.roadtour_runs r
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.roadtour_event_reward_rule_versions existing
    WHERE existing.roadtour_event_id = r.id
  )
  RETURNING id, roadtour_event_id
)
UPDATE public.roadtour_runs r
SET active_reward_rule_version_id = inserted.id
FROM inserted
WHERE r.id = inserted.roadtour_event_id
  AND r.active_reward_rule_version_id IS NULL;

UPDATE public.roadtour_runs r
SET active_reward_rule_version_id = active_rule.id
FROM public.roadtour_event_reward_rule_versions active_rule
WHERE active_rule.roadtour_event_id = r.id
  AND active_rule.status = 'active'
  AND active_rule.effective_to IS NULL
  AND r.active_reward_rule_version_id IS NULL;

CREATE OR REPLACE FUNCTION public.sync_roadtour_event_reward_rule_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule_id uuid;
  v_version_no integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(MAX(version_no), 0) + 1
    INTO v_version_no
    FROM public.roadtour_event_reward_rule_versions
    WHERE roadtour_event_id = NEW.id;

    INSERT INTO public.roadtour_event_reward_rule_versions (
      roadtour_event_id,
      version_no,
      status,
      point_release_rule,
      required_product_qr_scans,
      product_qr_counting_period,
      unique_product_qr_only,
      effective_from,
      created_by,
      metadata
    ) VALUES (
      NEW.id,
      v_version_no,
      'active',
      NEW.point_release_rule,
      NEW.required_product_qr_scans,
      NEW.product_qr_counting_period,
      COALESCE(NEW.unique_product_qr_only, true),
      now(),
      COALESCE(NEW.updated_by, NEW.created_by),
      jsonb_build_object('source', 'roadtour_runs_insert')
    )
    RETURNING id INTO v_rule_id;

    UPDATE public.roadtour_runs
    SET active_reward_rule_version_id = v_rule_id
    WHERE id = NEW.id;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    UPDATE public.roadtour_event_reward_rule_versions
    SET status = 'superseded', effective_to = now()
    WHERE roadtour_event_id = NEW.id
      AND status = 'active'
      AND effective_to IS NULL;

    SELECT COALESCE(MAX(version_no), 0) + 1
    INTO v_version_no
    FROM public.roadtour_event_reward_rule_versions
    WHERE roadtour_event_id = NEW.id;

    INSERT INTO public.roadtour_event_reward_rule_versions (
      roadtour_event_id,
      version_no,
      status,
      point_release_rule,
      required_product_qr_scans,
      product_qr_counting_period,
      unique_product_qr_only,
      effective_from,
      created_by,
      metadata
    ) VALUES (
      NEW.id,
      v_version_no,
      'active',
      NEW.point_release_rule,
      NEW.required_product_qr_scans,
      NEW.product_qr_counting_period,
      COALESCE(NEW.unique_product_qr_only, true),
      now(),
      NEW.updated_by,
      jsonb_build_object('source', 'roadtour_runs_rule_update')
    )
    RETURNING id INTO v_rule_id;

    UPDATE public.roadtour_runs
    SET active_reward_rule_version_id = v_rule_id
    WHERE id = NEW.id;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roadtour_runs_reward_rule_insert ON public.roadtour_runs;
CREATE TRIGGER trg_roadtour_runs_reward_rule_insert
AFTER INSERT ON public.roadtour_runs
FOR EACH ROW
EXECUTE FUNCTION public.sync_roadtour_event_reward_rule_version();

DROP TRIGGER IF EXISTS trg_roadtour_runs_reward_rule_update ON public.roadtour_runs;
CREATE TRIGGER trg_roadtour_runs_reward_rule_update
AFTER UPDATE OF point_release_rule, required_product_qr_scans, product_qr_counting_period, unique_product_qr_only
ON public.roadtour_runs
FOR EACH ROW
WHEN (
  OLD.point_release_rule IS DISTINCT FROM NEW.point_release_rule
  OR OLD.required_product_qr_scans IS DISTINCT FROM NEW.required_product_qr_scans
  OR OLD.product_qr_counting_period IS DISTINCT FROM NEW.product_qr_counting_period
  OR OLD.unique_product_qr_only IS DISTINCT FROM NEW.unique_product_qr_only
)
EXECUTE FUNCTION public.sync_roadtour_event_reward_rule_version();

-- ============================================================
-- 3. Participant missions, Product QR counted items, payouts
-- ============================================================
CREATE TABLE IF NOT EXISTS public.roadtour_participant_missions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roadtour_event_id uuid NOT NULL REFERENCES public.roadtour_runs(id) ON DELETE CASCADE,
  roadtour_campaign_id uuid NOT NULL REFERENCES public.roadtour_campaigns(id) ON DELETE CASCADE,
  participant_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  participant_phone_normalized text NOT NULL,
  participant_identity_type text NOT NULL CHECK (participant_identity_type IN ('user', 'phone', 'user_and_phone')),
  enrollment_scan_event_id uuid REFERENCES public.roadtour_scan_events(id) ON DELETE SET NULL,
  enrolled_at timestamptz NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  effective_period_end timestamptz NOT NULL,
  reward_rule_version_id uuid NOT NULL REFERENCES public.roadtour_event_reward_rule_versions(id) ON DELETE RESTRICT,
  required_product_qr_scans_snapshot integer NOT NULL CHECK (required_product_qr_scans_snapshot >= 1),
  campaign_reward_points_snapshot integer NOT NULL CHECK (campaign_reward_points_snapshot > 0),
  unique_product_qr_only_snapshot boolean NOT NULL DEFAULT true,
  current_valid_product_scan_count integer NOT NULL DEFAULT 0 CHECK (current_valid_product_scan_count >= 0),
  reward_status text NOT NULL DEFAULT 'pending' CHECK (reward_status IN ('pending', 'completed', 'awarded', 'expired', 'cancelled')),
  shop_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  last_progress_at timestamptz,
  completed_at timestamptz,
  awarded_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT roadtour_participant_missions_period_check CHECK (
    period_start < period_end AND period_start < effective_period_end
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_roadtour_missions_user_period
  ON public.roadtour_participant_missions (roadtour_event_id, roadtour_campaign_id, participant_user_id, period_start)
  WHERE participant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_roadtour_missions_participant_user
  ON public.roadtour_participant_missions (participant_user_id, reward_status, effective_period_end DESC);

CREATE INDEX IF NOT EXISTS idx_roadtour_missions_participant_phone
  ON public.roadtour_participant_missions (participant_phone_normalized, reward_status, effective_period_end DESC);

CREATE INDEX IF NOT EXISTS idx_roadtour_missions_event_campaign_status
  ON public.roadtour_participant_missions (roadtour_event_id, roadtour_campaign_id, reward_status);

CREATE INDEX IF NOT EXISTS idx_roadtour_missions_period
  ON public.roadtour_participant_missions (period_start, period_end, effective_period_end);

CREATE TABLE IF NOT EXISTS public.roadtour_mission_counted_product_qr_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.roadtour_participant_missions(id) ON DELETE CASCADE,
  product_scan_event_id uuid NOT NULL REFERENCES public.consumer_qr_scans(id) ON DELETE CASCADE,
  resolved_qr_code_id uuid NOT NULL REFERENCES public.qr_codes(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  raw_qr_code_text text,
  scanned_at timestamptz NOT NULL,
  counted_at timestamptz NOT NULL DEFAULT now(),
  participant_user_id_snapshot uuid,
  participant_phone_normalized_snapshot text NOT NULL,
  is_counted boolean NOT NULL DEFAULT true,
  is_duplicate boolean NOT NULL DEFAULT false,
  duplicate_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roadtour_counted_product_qr_duplicate_shape_check CHECK (
    (is_counted = true AND is_duplicate = false)
    OR (is_counted = false)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_roadtour_counted_product_qr_per_mission
  ON public.roadtour_mission_counted_product_qr_items (mission_id, resolved_qr_code_id)
  WHERE is_counted = true;

CREATE INDEX IF NOT EXISTS idx_roadtour_counted_product_qr_mission
  ON public.roadtour_mission_counted_product_qr_items (mission_id, counted_at DESC);

CREATE INDEX IF NOT EXISTS idx_roadtour_counted_product_qr_scan
  ON public.roadtour_mission_counted_product_qr_items (product_scan_event_id);

CREATE INDEX IF NOT EXISTS idx_roadtour_counted_product_qr_resolved
  ON public.roadtour_mission_counted_product_qr_items (mission_id, resolved_qr_code_id);

CREATE TABLE IF NOT EXISTS public.roadtour_mission_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.roadtour_participant_missions(id) ON DELETE CASCADE,
  participant_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  participant_phone_normalized text NOT NULL,
  campaign_reward_points_snapshot integer NOT NULL CHECK (campaign_reward_points_snapshot > 0),
  points_transaction_id uuid REFERENCES public.points_transactions(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  payout_status text NOT NULL DEFAULT 'pending' CHECK (payout_status IN ('pending', 'posted', 'failed', 'reversed')),
  qualified_at timestamptz NOT NULL,
  posted_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_roadtour_mission_payouts_mission
  ON public.roadtour_mission_payouts (mission_id);

CREATE INDEX IF NOT EXISTS idx_roadtour_mission_payouts_status
  ON public.roadtour_mission_payouts (payout_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_roadtour_mission_payouts_idempotency
  ON public.roadtour_mission_payouts (idempotency_key);

-- ============================================================
-- 4. RLS: no direct client writes; scoped admin and self reads only
-- ============================================================
ALTER TABLE public.roadtour_event_reward_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadtour_participant_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadtour_mission_counted_product_qr_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roadtour_mission_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roadtour_event_reward_rule_versions_admin_select ON public.roadtour_event_reward_rule_versions;
CREATE POLICY roadtour_event_reward_rule_versions_admin_select
ON public.roadtour_event_reward_rule_versions
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role_code IN ('SA','HQ','POWER_USER','HQ_ADMIN','SUPER_ADMIN','ADMIN')
  )
);

DROP POLICY IF EXISTS roadtour_participant_missions_admin_select ON public.roadtour_participant_missions;
CREATE POLICY roadtour_participant_missions_admin_select
ON public.roadtour_participant_missions
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role_code IN ('SA','HQ','POWER_USER','HQ_ADMIN','SUPER_ADMIN','ADMIN')
  )
);

DROP POLICY IF EXISTS roadtour_participant_missions_self_select ON public.roadtour_participant_missions;
CREATE POLICY roadtour_participant_missions_self_select
ON public.roadtour_participant_missions
FOR SELECT USING (participant_user_id = auth.uid());

DROP POLICY IF EXISTS roadtour_counted_product_qr_items_admin_select ON public.roadtour_mission_counted_product_qr_items;
CREATE POLICY roadtour_counted_product_qr_items_admin_select
ON public.roadtour_mission_counted_product_qr_items
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role_code IN ('SA','HQ','POWER_USER','HQ_ADMIN','SUPER_ADMIN','ADMIN')
  )
);

DROP POLICY IF EXISTS roadtour_counted_product_qr_items_self_select ON public.roadtour_mission_counted_product_qr_items;
CREATE POLICY roadtour_counted_product_qr_items_self_select
ON public.roadtour_mission_counted_product_qr_items
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_participant_missions m
    WHERE m.id = mission_id
      AND m.participant_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS roadtour_mission_payouts_admin_select ON public.roadtour_mission_payouts;
CREATE POLICY roadtour_mission_payouts_admin_select
ON public.roadtour_mission_payouts
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role_code IN ('SA','HQ','POWER_USER','HQ_ADMIN','SUPER_ADMIN','ADMIN')
  )
);

DROP POLICY IF EXISTS roadtour_mission_payouts_self_select ON public.roadtour_mission_payouts;
CREATE POLICY roadtour_mission_payouts_self_select
ON public.roadtour_mission_payouts
FOR SELECT USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_participant_missions m
    WHERE m.id = mission_id
      AND m.participant_user_id = auth.uid()
  )
);

-- ============================================================
-- 5. Helper functions for mission creation and progress payout
-- ============================================================
CREATE OR REPLACE FUNCTION public.roadtour_normalize_phone_key(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_digits text;
BEGIN
  v_digits := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  IF v_digits = '' THEN
    RETURN NULL;
  END IF;
  IF left(v_digits, 1) = '0' THEN
    v_digits := '60' || substring(v_digits from 2);
  END IF;
  RETURN v_digits;
END;
$$;

CREATE OR REPLACE FUNCTION public.roadtour_calculate_mission_period(
  p_enrolled_at timestamptz,
  p_counting_period text,
  p_campaign_end date,
  p_event_end date
)
RETURNS TABLE (
  period_start timestamptz,
  period_end timestamptz,
  effective_period_end timestamptz
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_local_start timestamp;
  v_natural_end timestamptz;
  v_campaign_end_exclusive timestamptz;
  v_event_end_exclusive timestamptz;
BEGIN
  v_local_start := p_enrolled_at AT TIME ZONE 'Asia/Kuala_Lumpur';
  v_campaign_end_exclusive := ((p_campaign_end + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur');
  v_event_end_exclusive := ((p_event_end + 1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur');

  IF p_counting_period = 'rolling_1_month' THEN
    v_natural_end := ((v_local_start + interval '1 month') AT TIME ZONE 'Asia/Kuala_Lumpur');
  ELSIF p_counting_period = 'rolling_2_months' THEN
    v_natural_end := ((v_local_start + interval '2 months') AT TIME ZONE 'Asia/Kuala_Lumpur');
  ELSIF p_counting_period = 'open_period' THEN
    v_natural_end := LEAST(v_campaign_end_exclusive, v_event_end_exclusive);
  ELSE
    RAISE EXCEPTION 'Unsupported RoadTour Product QR counting period: %', p_counting_period;
  END IF;

  period_start := p_enrolled_at;
  period_end := v_natural_end;
  effective_period_end := LEAST(v_natural_end, v_campaign_end_exclusive, v_event_end_exclusive);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.roadtour_mission_response(p_mission public.roadtour_participant_missions)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'mission_id', p_mission.id,
    'reward_status', p_mission.reward_status,
    'campaign_reward_points', p_mission.campaign_reward_points_snapshot,
    'required_product_qr_scans', p_mission.required_product_qr_scans_snapshot,
    'current_valid_product_scan_count', p_mission.current_valid_product_scan_count,
    'remaining_product_qr_scans', GREATEST(p_mission.required_product_qr_scans_snapshot - p_mission.current_valid_product_scan_count, 0),
    'period_start', p_mission.period_start,
    'period_end', p_mission.effective_period_end,
    'completed_at', p_mission.completed_at,
    'awarded_at', p_mission.awarded_at,
    'message', CASE
      WHEN p_mission.reward_status = 'awarded' THEN format('Milestone completed. %s points awarded.', p_mission.campaign_reward_points_snapshot)
      WHEN p_mission.reward_status = 'expired' THEN 'This RoadTour reward period has ended.'
      ELSE format(
        'You will be entitled to %s points after scanning %s product QR codes.',
        p_mission.campaign_reward_points_snapshot,
        p_mission.required_product_qr_scans_snapshot
      )
    END
  );
$$;

CREATE OR REPLACE FUNCTION public.roadtour_create_participant_mission(
  p_roadtour_event_id uuid,
  p_roadtour_campaign_id uuid,
  p_participant_user_id uuid,
  p_participant_phone text,
  p_enrollment_scan_event_id uuid,
  p_shop_id uuid DEFAULT NULL::uuid,
  p_created_by uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_campaign record;
  v_rule record;
  v_phone text;
  v_user_phone text;
  v_enrolled_at timestamptz := now();
  v_period record;
  v_existing public.roadtour_participant_missions;
  v_created public.roadtour_participant_missions;
  v_identity_type text;
BEGIN
  IF p_participant_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'PARTICIPANT_REQUIRED', 'message', 'Please sign in before starting this RoadTour mission.');
  END IF;

  SELECT phone INTO v_user_phone
  FROM public.users
  WHERE id = p_participant_user_id;

  v_phone := public.roadtour_normalize_phone_key(COALESCE(p_participant_phone, v_user_phone));
  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'PHONE_REQUIRED', 'message', 'A participant phone number is required to start this RoadTour mission.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_roadtour_event_id::text || ':' || p_roadtour_campaign_id::text || ':' || p_participant_user_id::text, 0));

  SELECT
    c.id,
    c.org_id,
    c.default_points,
    c.end_date AS campaign_end_date,
    r.end_date AS event_end_date
  INTO v_campaign
  FROM public.roadtour_campaigns c
  JOIN public.roadtour_runs r ON r.id = c.roadtour_run_id
  WHERE c.id = p_roadtour_campaign_id
    AND r.id = p_roadtour_event_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'CAMPAIGN_EVENT_MISMATCH', 'message', 'RoadTour campaign is not linked to this event.');
  END IF;

  SELECT rv.*
  INTO v_rule
  FROM public.roadtour_event_reward_rule_versions rv
  JOIN public.roadtour_runs r ON r.active_reward_rule_version_id = rv.id
  WHERE r.id = p_roadtour_event_id
    AND rv.status = 'active'
    AND rv.effective_to IS NULL;

  IF NOT FOUND OR v_rule.point_release_rule <> 'product_qr_scan_target_once' THEN
    RETURN jsonb_build_object('success', false, 'code', 'NOT_MILESTONE_RULE', 'message', 'This RoadTour Event is not using Product QR milestone release.');
  END IF;

  SELECT *
  INTO v_existing
  FROM public.roadtour_participant_missions m
  WHERE m.roadtour_event_id = p_roadtour_event_id
    AND m.roadtour_campaign_id = p_roadtour_campaign_id
    AND (
      m.participant_user_id = p_participant_user_id
      OR m.participant_phone_normalized = v_phone
    )
    AND m.reward_status IN ('pending', 'completed', 'awarded')
    AND now() < m.effective_period_end
  ORDER BY m.enrolled_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'roadtour_reward_deferred', true,
      'code', CASE WHEN v_existing.reward_status = 'awarded' THEN 'MILESTONE_AWARDED' ELSE 'MILESTONE_PROGRESS' END,
      'mission', public.roadtour_mission_response(v_existing)
    );
  END IF;

  SELECT *
  INTO v_period
  FROM public.roadtour_calculate_mission_period(
    v_enrolled_at,
    v_rule.product_qr_counting_period,
    v_campaign.campaign_end_date,
    v_campaign.event_end_date
  );

  v_identity_type := 'user_and_phone';

  INSERT INTO public.roadtour_participant_missions (
    roadtour_event_id,
    roadtour_campaign_id,
    participant_user_id,
    participant_phone_normalized,
    participant_identity_type,
    enrollment_scan_event_id,
    enrolled_at,
    period_start,
    period_end,
    effective_period_end,
    reward_rule_version_id,
    required_product_qr_scans_snapshot,
    campaign_reward_points_snapshot,
    unique_product_qr_only_snapshot,
    reward_status,
    shop_id,
    created_by,
    metadata
  ) VALUES (
    p_roadtour_event_id,
    p_roadtour_campaign_id,
    p_participant_user_id,
    v_phone,
    v_identity_type,
    p_enrollment_scan_event_id,
    v_enrolled_at,
    v_period.period_start,
    v_period.period_end,
    v_period.effective_period_end,
    v_rule.id,
    v_rule.required_product_qr_scans,
    v_campaign.default_points,
    v_rule.unique_product_qr_only,
    'pending',
    p_shop_id,
    p_created_by,
    jsonb_build_object('source', 'roadtour_claim_enrollment')
  )
  RETURNING * INTO v_created;

  IF p_enrollment_scan_event_id IS NOT NULL THEN
    UPDATE public.roadtour_scan_events
    SET scan_status = 'success', points_awarded = 0
    WHERE id = p_enrollment_scan_event_id;
  END IF;

  IF p_shop_id IS NOT NULL THEN
    INSERT INTO public.roadtour_official_visits (
      campaign_id,
      account_manager_user_id,
      shop_id,
      official_scan_event_id,
      visit_date,
      roadtour_run_id
    )
    SELECT
      s.campaign_id,
      s.account_manager_user_id,
      p_shop_id,
      s.id,
      CURRENT_DATE,
      p_roadtour_event_id
    FROM public.roadtour_scan_events s
    WHERE s.id = p_enrollment_scan_event_id
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'roadtour_reward_deferred', true,
    'code', 'MILESTONE_STARTED',
    'mission', public.roadtour_mission_response(v_created)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.roadtour_record_product_qr_milestone_progress(
  p_product_scan_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_scan record;
  v_user record;
  v_phone text;
  v_mission public.roadtour_participant_missions;
  v_inserted_count integer;
  v_count integer;
  v_balance integer;
  v_txn_id uuid;
  v_payout_id uuid;
  v_company_id uuid;
  v_response jsonb := '[]'::jsonb;
  v_duplicate boolean := false;
  v_awarded boolean := false;
BEGIN
  SELECT
    s.id,
    s.qr_code_id,
    s.consumer_id,
    s.consumer_phone,
    s.consumer_email,
    s.consumer_name,
    COALESCE(s.scanned_at, s.points_collected_at, s.created_at, now()) AS scanned_at,
    s.collected_points,
    s.is_manual_adjustment,
    q.code AS raw_qr_code_text,
    q.product_id
  INTO v_scan
  FROM public.consumer_qr_scans s
  JOIN public.qr_codes q ON q.id = s.qr_code_id
  WHERE s.id = p_product_scan_event_id
    AND s.collected_points = true
    AND COALESCE(s.is_manual_adjustment, false) = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'milestone_evaluated', false, 'reason', 'product_scan_not_eligible');
  END IF;

  IF v_scan.consumer_id IS NULL OR v_scan.qr_code_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'milestone_evaluated', false, 'reason', 'anonymous_or_unresolved_scan');
  END IF;

  SELECT id, phone, email, full_name
  INTO v_user
  FROM public.users
  WHERE id = v_scan.consumer_id;

  v_phone := public.roadtour_normalize_phone_key(COALESCE(v_scan.consumer_phone, v_user.phone));

  FOR v_mission IN
    SELECT *
    FROM public.roadtour_participant_missions m
    WHERE m.reward_status = 'pending'
      AND (
        m.participant_user_id = v_scan.consumer_id
        OR (v_phone IS NOT NULL AND m.participant_phone_normalized = v_phone)
      )
      AND v_scan.scanned_at >= m.period_start
      AND v_scan.scanned_at < m.effective_period_end
    ORDER BY m.enrolled_at ASC
    FOR UPDATE
  LOOP
    INSERT INTO public.roadtour_mission_counted_product_qr_items (
      mission_id,
      product_scan_event_id,
      resolved_qr_code_id,
      product_id,
      raw_qr_code_text,
      scanned_at,
      participant_user_id_snapshot,
      participant_phone_normalized_snapshot,
      is_counted,
      is_duplicate,
      metadata
    ) VALUES (
      v_mission.id,
      v_scan.id,
      v_scan.qr_code_id,
      v_scan.product_id,
      v_scan.raw_qr_code_text,
      v_scan.scanned_at,
      v_scan.consumer_id,
      COALESCE(v_phone, v_mission.participant_phone_normalized),
      true,
      false,
      jsonb_build_object('source', 'consumer_collect_points')
    )
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    IF v_inserted_count = 0 THEN
      v_duplicate := true;
      INSERT INTO public.roadtour_mission_counted_product_qr_items (
        mission_id,
        product_scan_event_id,
        resolved_qr_code_id,
        product_id,
        raw_qr_code_text,
        scanned_at,
        participant_user_id_snapshot,
        participant_phone_normalized_snapshot,
        is_counted,
        is_duplicate,
        duplicate_reason,
        metadata
      ) VALUES (
        v_mission.id,
        v_scan.id,
        v_scan.qr_code_id,
        v_scan.product_id,
        v_scan.raw_qr_code_text,
        v_scan.scanned_at,
        v_scan.consumer_id,
        COALESCE(v_phone, v_mission.participant_phone_normalized),
        false,
        true,
        'resolved_qr_code_already_counted_for_mission',
        jsonb_build_object('source', 'consumer_collect_points')
      );
    END IF;

    SELECT COUNT(*)::integer
    INTO v_count
    FROM public.roadtour_mission_counted_product_qr_items counted
    WHERE counted.mission_id = v_mission.id
      AND counted.is_counted = true;

    UPDATE public.roadtour_participant_missions
    SET current_valid_product_scan_count = v_count,
        last_progress_at = CASE WHEN v_inserted_count > 0 THEN v_scan.scanned_at ELSE last_progress_at END,
        completed_at = CASE
          WHEN v_count >= required_product_qr_scans_snapshot AND completed_at IS NULL THEN now()
          ELSE completed_at
        END,
        reward_status = CASE
          WHEN v_count >= required_product_qr_scans_snapshot THEN 'completed'
          ELSE reward_status
        END
    WHERE id = v_mission.id
    RETURNING * INTO v_mission;

    IF v_mission.reward_status = 'completed' THEN
      INSERT INTO public.roadtour_mission_payouts (
        mission_id,
        participant_user_id,
        participant_phone_normalized,
        campaign_reward_points_snapshot,
        idempotency_key,
        payout_status,
        qualified_at,
        metadata
      ) VALUES (
        v_mission.id,
        v_mission.participant_user_id,
        v_mission.participant_phone_normalized,
        v_mission.campaign_reward_points_snapshot,
        'roadtour_mission:' || v_mission.id::text,
        'pending',
        COALESCE(v_mission.completed_at, now()),
        jsonb_build_object('source', 'roadtour_product_qr_milestone')
      )
      ON CONFLICT (mission_id) DO NOTHING
      RETURNING id INTO v_payout_id;

      SELECT id
      INTO v_payout_id
      FROM public.roadtour_mission_payouts
      WHERE mission_id = v_mission.id
      FOR UPDATE;

      IF EXISTS (
        SELECT 1
        FROM public.roadtour_mission_payouts p
        WHERE p.id = v_payout_id
          AND p.payout_status = 'posted'
          AND p.points_transaction_id IS NOT NULL
      ) THEN
        UPDATE public.roadtour_participant_missions
        SET reward_status = 'awarded', awarded_at = COALESCE(awarded_at, now())
        WHERE id = v_mission.id
        RETURNING * INTO v_mission;
      ELSE
        SELECT c.org_id
        INTO v_company_id
        FROM public.roadtour_campaigns c
        WHERE c.id = v_mission.roadtour_campaign_id;

        SELECT COALESCE(v.current_balance, 0)::integer
        INTO v_balance
        FROM public.v_consumer_points_balance v
        WHERE v.user_id = v_mission.participant_user_id;

        IF v_balance IS NULL THEN
          SELECT COALESCE(SUM(points_change), 0)::integer
          INTO v_balance
          FROM public.shop_points_ledger
          WHERE consumer_id = v_mission.participant_user_id;
        END IF;

        IF v_balance IS NULL THEN
          SELECT COALESCE(SUM(points_amount), 0)::integer
          INTO v_balance
          FROM public.consumer_qr_scans
          WHERE consumer_id = v_mission.participant_user_id
            AND collected_points = true;
        END IF;

        IF v_balance IS NULL THEN
          v_balance := 0;
        END IF;

        INSERT INTO public.points_transactions (
          company_id,
          consumer_phone,
          consumer_email,
          transaction_type,
          points_amount,
          balance_after,
          description,
          transaction_date,
          user_id,
          created_by,
          point_category,
          point_indicator,
          point_owner_type,
          point_direction,
          wallet_scope,
          wallet_owner_user_id,
          wallet_owner_org_id,
          reporting_shop_id,
          wallet_balance_after,
          wallet_source
        ) VALUES (
          v_company_id,
          COALESCE(v_user.phone, v_mission.participant_phone_normalized, ''),
          v_user.email,
          'roadtour',
          v_mission.campaign_reward_points_snapshot,
          v_balance + v_mission.campaign_reward_points_snapshot,
          format('RoadTour Product QR milestone reward (%s points)', v_mission.campaign_reward_points_snapshot),
          now(),
          v_mission.participant_user_id,
          v_mission.participant_user_id,
          'roadtour',
          'product_qr_milestone',
          'consumer',
          'earn',
          'consumer',
          v_mission.participant_user_id,
          NULL,
          v_mission.shop_id,
          v_balance + v_mission.campaign_reward_points_snapshot,
          'roadtour_product_qr_milestone'
        )
        RETURNING id INTO v_txn_id;

        UPDATE public.roadtour_mission_payouts
        SET payout_status = 'posted',
            points_transaction_id = v_txn_id,
            posted_at = now()
        WHERE id = v_payout_id;

        UPDATE public.roadtour_participant_missions
        SET reward_status = 'awarded', awarded_at = now()
        WHERE id = v_mission.id
        RETURNING * INTO v_mission;

        UPDATE public.roadtour_scan_events
        SET points_awarded = v_mission.campaign_reward_points_snapshot,
            reward_transaction_id = v_txn_id,
            scan_status = 'success'
        WHERE id = v_mission.enrollment_scan_event_id;

        UPDATE public.roadtour_survey_responses
        SET points_awarded = v_mission.campaign_reward_points_snapshot,
            reward_transaction_id = v_txn_id
        WHERE scan_event_id = v_mission.enrollment_scan_event_id;

        v_awarded := true;
      END IF;
    END IF;

    v_response := v_response || jsonb_build_array(public.roadtour_mission_response(v_mission));
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'milestone_evaluated', jsonb_array_length(v_response) > 0,
    'milestone_awarded', v_awarded,
    'duplicate_product_qr', v_duplicate,
    'missions', v_response
  );
END;
$$;

-- ============================================================
-- 6. Preserve Product QR collect behavior while returning scan id
-- ============================================================
CREATE OR REPLACE FUNCTION public.consumer_collect_points(
  p_raw_qr_code text,
  p_shop_id text,
  p_points_amount numeric DEFAULT NULL::numeric,
  p_claim_lane text DEFAULT 'consumer'::text,
  p_allow_dual_claim boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_qr_record RECORD;
  v_base_code text;
  v_valid_statuses text[] := ARRAY['received_warehouse', 'warehouse_packed', 'shipped_distributor', 'activated', 'verified'];
  v_points numeric;
  v_shop_org_id uuid;
  v_user_full_name text;
  v_user_phone text;
  v_user_email text;
  v_lane_collected boolean;
  v_scan_id uuid;
  v_scanned_at timestamptz := now();
BEGIN
  SELECT * INTO v_qr_record
  FROM public.qr_codes
  WHERE code = p_raw_qr_code
  FOR UPDATE;

  IF v_qr_record IS NULL THEN
    v_base_code := regexp_replace(p_raw_qr_code, '-[^-]+$', '');
    IF v_base_code != p_raw_qr_code THEN
      SELECT * INTO v_qr_record
      FROM public.qr_codes
      WHERE code = v_base_code
      FOR UPDATE;
    END IF;
  END IF;

  IF v_qr_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR code not found', 'code', 'QR_NOT_FOUND', 'preview', true);
  END IF;

  IF NOT (v_qr_record.status = ANY(v_valid_statuses)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'QR code is not active', 'code', 'INVALID_STATUS');
  END IF;

  IF NOT p_allow_dual_claim THEN
    IF COALESCE(v_qr_record.is_shop_points_collected, false)
      OR COALESCE(v_qr_record.is_consumer_points_collected, false)
      OR COALESCE(v_qr_record.is_points_collected, false) THEN
      RETURN jsonb_build_object(
        'success', false,
        'already_collected', true,
        'error', 'Points for this QR code have already been collected.',
        'points_earned', v_qr_record.points_value
      );
    END IF;
  ELSE
    IF p_claim_lane = 'shop' THEN
      v_lane_collected := COALESCE(v_qr_record.is_shop_points_collected, false);
    ELSE
      v_lane_collected := COALESCE(v_qr_record.is_consumer_points_collected, false);
    END IF;

    IF v_lane_collected THEN
      RETURN jsonb_build_object(
        'success', false,
        'already_collected', true,
        'error', 'Points for this QR code have already been collected.',
        'points_earned', v_qr_record.points_value
      );
    END IF;
  END IF;

  v_points := COALESCE(p_points_amount, v_qr_record.points_value, 0);

  SELECT organization_id, full_name, phone, email
  INTO v_shop_org_id, v_user_full_name, v_user_phone, v_user_email
  FROM public.users
  WHERE id = p_shop_id::uuid;

  IF p_claim_lane = 'shop' THEN
    UPDATE public.qr_codes
    SET is_points_collected = true,
        is_shop_points_collected = true,
        points_collected_at = v_scanned_at,
        points_value = v_points
    WHERE id = v_qr_record.id;
  ELSE
    IF v_shop_org_id IS NULL AND v_qr_record.consumer_name IS NULL THEN
      UPDATE public.qr_codes
      SET is_points_collected = true,
          is_consumer_points_collected = true,
          points_collected_at = v_scanned_at,
          points_value = v_points,
          consumer_name = COALESCE(v_user_full_name, v_qr_record.consumer_name),
          consumer_phone = COALESCE(v_user_phone, v_qr_record.consumer_phone),
          consumer_email = COALESCE(v_user_email, v_qr_record.consumer_email)
      WHERE id = v_qr_record.id;
    ELSE
      UPDATE public.qr_codes
      SET is_points_collected = true,
          is_consumer_points_collected = true,
          points_collected_at = v_scanned_at,
          points_value = v_points
      WHERE id = v_qr_record.id;
    END IF;
  END IF;

  INSERT INTO public.consumer_qr_scans (
    qr_code_id,
    shop_id,
    consumer_id,
    collected_points,
    points_amount,
    points_collected_at,
    scanned_at,
    adjustment_type,
    claim_lane,
    consumer_name,
    consumer_phone,
    consumer_email
  ) VALUES (
    v_qr_record.id,
    v_shop_org_id,
    p_shop_id::uuid,
    true,
    v_points,
    v_scanned_at,
    v_scanned_at,
    'scan',
    p_claim_lane,
    v_user_full_name,
    v_user_phone,
    v_user_email
  )
  RETURNING id INTO v_scan_id;

  RETURN jsonb_build_object(
    'success', true,
    'points_earned', v_points,
    'message', 'Points collected successfully',
    'scan_id', v_scan_id,
    'qr_code_id', v_qr_record.id,
    'scanned_at', v_scanned_at
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM, 'code', 'INTERNAL_ERROR');
END;
$$;

CREATE OR REPLACE FUNCTION public.consumer_collect_points(
  p_raw_qr_code text,
  p_shop_id text,
  p_points_amount numeric DEFAULT NULL::numeric,
  p_claim_lane text DEFAULT 'consumer'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN public.consumer_collect_points(p_raw_qr_code, p_shop_id, p_points_amount, p_claim_lane, true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.roadtour_create_participant_mission(uuid, uuid, uuid, text, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roadtour_create_participant_mission(uuid, uuid, uuid, text, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.roadtour_record_product_qr_milestone_progress(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.roadtour_record_product_qr_milestone_progress(uuid) TO service_role;

COMMIT;