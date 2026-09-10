-- RoadTour intervention identity, shop-scoped reward protection and visit_date timezone.
--
-- Background (all verified read-only against production before writing this):
--   * All 199 roadtour_scan_events rows had shop_id NULL, because the claim route
--     persisted the QR's shop (always null for an AM QR) instead of the shop the
--     reward was attributed to. Every shop-scoped duplicate rule filters that
--     column, so none of them could ever match.
--   * record_roadtour_reward had no branch for the shop-scoped rules and fell
--     through to `v_existing_count := 0` — no check at all.
--   * Result: 8 shops received two rewards inside one campaign (800 excess
--     points). Those balances are deliberately left untouched; see
--     docs/roadtourmodules/ROADTOUR_MIGRATION_PLAN_AND_AUDITS.md.
--   * The run-level unique index blocked the revisit that a new campaign is
--     created to represent, and record_roadtour_reward swallowed the violation.
--   * visit_date came from CURRENT_DATE (server UTC), so a scan before 08:00
--     Malaysia time was dated to the previous day and could fall in the wrong
--     reporting month. Zero existing rows are affected, so no backfill.
--
-- Order matters: shop attribution and reward protection must be in place BEFORE
-- the official-visit uniqueness is tightened, or a blocked visit would coexist
-- with a paid reward.

BEGIN;

-- ── Step 1 · reliable shop attribution on existing scan events ──────────────
-- The survey response captured the shop even when the scan event did not.
-- Rows that cannot be resolved stay NULL rather than being guessed.
UPDATE public.roadtour_scan_events se
SET shop_id = sr.shop_id
FROM public.roadtour_survey_responses sr
WHERE sr.scan_event_id = se.id
  AND se.shop_id IS NULL
  AND sr.shop_id IS NOT NULL;

-- Official visits already carry a trustworthy shop; use them for any remainder.
UPDATE public.roadtour_scan_events se
SET shop_id = ov.shop_id
FROM public.roadtour_official_visits ov
WHERE ov.official_scan_event_id = se.id
  AND se.shop_id IS NULL
  AND ov.shop_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_roadtour_scan_events_campaign_shop
  ON public.roadtour_scan_events (campaign_id, shop_id)
  WHERE shop_id IS NOT NULL;

-- ── Step 4 (schema) · one intervention per shop per campaign ────────────────
-- Dropped: the run-level rule blocked a legitimate revisit under a new campaign,
-- and the AM-scoped rule was strictly weaker — it would have let one shop claim
-- once from every account manager in the same campaign.
DROP INDEX IF EXISTS public.uq_roadtour_official_visit_per_run_shop;

ALTER TABLE public.roadtour_official_visits
  DROP CONSTRAINT IF EXISTS uq_roadtour_official_visit;

-- Verified before writing: zero existing (campaign_id, shop_id) duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_roadtour_official_visit_per_campaign_shop
  ON public.roadtour_official_visits (campaign_id, shop_id)
  WHERE visit_status = 'official';

-- ── Steps 2, 3, 5 · reward function ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_roadtour_reward(
  p_org_id uuid,
  p_campaign_id uuid,
  p_qr_code_id uuid,
  p_account_manager_user_id uuid,
  p_scanned_by_user_id uuid,
  p_shop_id uuid,
  p_points integer,
  p_scan_event_id uuid DEFAULT NULL::uuid,
  p_survey_response_id uuid DEFAULT NULL::uuid,
  p_duplicate_rule text DEFAULT 'per_campaign'::text,
  p_transaction_type text DEFAULT 'roadtour'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_existing_count integer := 0;
  v_balance integer := 0;
  v_txn_id uuid;
  v_phone text;
  v_email text;
  v_description text;
  v_scan_time timestamptz;
  v_visit_date date;
  v_visit_blocked boolean := false;
  v_visit_blocked_reason text := NULL;
BEGIN
  -- ── Duplicate protection ──────────────────────────────────────────────────
  -- Shop-scoped rules come first: a campaign may hand out several account
  -- manager QRs, and a shop must only be rewarded once across all of them.
  IF p_duplicate_rule IN ('per_campaign', 'one_shop_once_per_campaign') THEN
    IF p_shop_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false, 'error', 'shop_required',
        'message', 'This RoadTour reward is limited to one claim per shop, so the shop must be identified before the reward can be issued.'
      );
    END IF;
    SELECT COUNT(*) INTO v_existing_count
    FROM public.roadtour_scan_events
    WHERE campaign_id = p_campaign_id
      AND shop_id = p_shop_id
      AND scan_status = 'success'
      AND points_awarded > 0;

  ELSIF p_duplicate_rule = 'per_run' THEN
    IF p_shop_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false, 'error', 'shop_required',
        'message', 'This RoadTour reward is limited to one claim per shop, so the shop must be identified before the reward can be issued.'
      );
    END IF;
    SELECT COUNT(*) INTO v_existing_count
    FROM public.roadtour_official_visits ov
    WHERE ov.shop_id = p_shop_id
      AND ov.visit_status = 'official'
      AND ov.roadtour_run_id = (
        SELECT roadtour_run_id FROM public.roadtour_campaigns WHERE id = p_campaign_id
      );

  ELSIF p_duplicate_rule = 'per_day' THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM public.roadtour_scan_events
    WHERE campaign_id = p_campaign_id
      AND shop_id IS NOT DISTINCT FROM p_shop_id
      AND scan_status = 'success'
      AND points_awarded > 0
      AND (scan_time AT TIME ZONE 'Asia/Kuala_Lumpur')::date
          = (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;

  ELSIF p_duplicate_rule = 'one_per_user_per_campaign' THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM public.roadtour_scan_events
    WHERE campaign_id = p_campaign_id
      AND scanned_by_user_id = p_scanned_by_user_id
      AND scan_status = 'success'
      AND points_awarded > 0;

  ELSIF p_duplicate_rule = 'one_per_user_per_day' THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM public.roadtour_scan_events
    WHERE campaign_id = p_campaign_id
      AND scanned_by_user_id = p_scanned_by_user_id
      AND scan_status = 'success'
      AND points_awarded > 0
      AND (scan_time AT TIME ZONE 'Asia/Kuala_Lumpur')::date
          = (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;

  ELSIF p_duplicate_rule = 'one_per_shop_per_am_per_day' THEN
    -- `shop_id = p_shop_id` silently never matched while the column was NULL.
    SELECT COUNT(*) INTO v_existing_count
    FROM public.roadtour_scan_events
    WHERE campaign_id = p_campaign_id
      AND account_manager_user_id = p_account_manager_user_id
      AND shop_id IS NOT DISTINCT FROM p_shop_id
      AND scan_status = 'success'
      AND points_awarded > 0
      AND (scan_time AT TIME ZONE 'Asia/Kuala_Lumpur')::date
          = (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;

  ELSE
    v_existing_count := 0;
  END IF;

  IF v_existing_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'duplicate', 'message', 'Reward already claimed based on the duplicate prevention rule.');
  END IF;

  SELECT COALESCE(v.current_balance, 0) INTO v_balance
  FROM public.v_consumer_points_balance v
  WHERE v.user_id = p_scanned_by_user_id;
  IF v_balance IS NULL THEN
    v_balance := 0;
  END IF;

  SELECT u.phone, u.email INTO v_phone, v_email
  FROM public.users u WHERE u.id = p_scanned_by_user_id;

  v_description := format('RoadTour bonus — campaign scan reward (%s points)', p_points);

  INSERT INTO public.points_transactions (
    user_id, transaction_type, points, description, reference_id, phone, email, org_id
  ) VALUES (
    p_scanned_by_user_id, p_transaction_type, p_points, v_description, p_scan_event_id, v_phone, v_email, p_org_id
  ) RETURNING id INTO v_txn_id;

  IF p_survey_response_id IS NOT NULL THEN
    UPDATE public.roadtour_survey_responses
    SET points_awarded = p_points, reward_transaction_id = v_txn_id
    WHERE id = p_survey_response_id;
  END IF;

  -- ── Official visit ────────────────────────────────────────────────────────
  -- visit_date is the reporting anchor, so it must be the Malaysia-local date of
  -- the scan itself, never the database server's UTC date.
  SELECT scan_time INTO v_scan_time
  FROM public.roadtour_scan_events WHERE id = p_scan_event_id;

  v_visit_date := (COALESCE(v_scan_time, now()) AT TIME ZONE 'Asia/Kuala_Lumpur')::date;

  IF p_shop_id IS NULL THEN
    v_visit_blocked := true;
    v_visit_blocked_reason := 'shop_unknown';
  ELSE
    BEGIN
      INSERT INTO public.roadtour_official_visits (
        campaign_id, account_manager_user_id, shop_id,
        official_scan_event_id, official_survey_response_id, visit_date
      ) VALUES (
        p_campaign_id, p_account_manager_user_id, p_shop_id,
        p_scan_event_id, p_survey_response_id, v_visit_date
      );
    EXCEPTION
      WHEN unique_violation THEN
        -- Expected only when this shop already has an official visit for this
        -- campaign. Reported rather than swallowed so the caller can react.
        v_visit_blocked := true;
        v_visit_blocked_reason := 'duplicate_campaign_shop';
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_txn_id,
    'points_awarded', p_points,
    'balance_after', COALESCE(v_balance, 0) + COALESCE(p_points, 0),
    'official_visit_blocked', v_visit_blocked,
    'official_visit_blocked_reason', v_visit_blocked_reason,
    'visit_date', v_visit_date,
    'message', 'RoadTour reward credited successfully.'
  );
END;
$function$;

-- ── Step 2 (configuration) · adopt the shop-scoped rule ─────────────────────
-- Capture the previous value before running this migration; see the rollback
-- section of docs/roadtourmodules/ROADTOUR_MIGRATION_PLAN_AND_AUDITS.md.
UPDATE public.roadtour_runs
SET duplicate_policy = 'per_campaign'
WHERE duplicate_policy = 'one_participant_once_per_event';

COMMIT;
