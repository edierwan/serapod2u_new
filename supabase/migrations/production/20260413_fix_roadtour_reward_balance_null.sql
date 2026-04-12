-- Fix: record_roadtour_reward crashes with "null value in column balance_after"
-- when user has no prior points transactions.
--
-- Root cause: SELECT ... INTO v_balance returns NULL (not 0) when zero rows match,
-- overriding the variable's := 0 initialisation. NULL + p_points = NULL → NOT NULL
-- constraint violation on points_transactions.balance_after.
--
-- Fix: add explicit NULL guard after the balance query, and wrap the INSERT
-- expression with COALESCE as a belt-and-suspenders defence.

CREATE OR REPLACE FUNCTION public.record_roadtour_reward(
  p_org_id uuid, p_campaign_id uuid, p_qr_code_id uuid,
  p_account_manager_user_id uuid, p_scanned_by_user_id uuid,
  p_shop_id uuid, p_points integer,
  p_scan_event_id uuid DEFAULT NULL, p_survey_response_id uuid DEFAULT NULL,
  p_duplicate_rule text DEFAULT 'one_per_user_per_campaign',
  p_transaction_type text DEFAULT 'roadtour'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  v_existing_count integer;
  v_balance integer := 0;
  v_txn_id uuid;
  v_phone text;
  v_email text;
  v_description text;
BEGIN
  -- Check duplicate based on rule
  IF p_duplicate_rule = 'one_per_user_per_campaign' THEN
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
      AND scan_time::date = CURRENT_DATE;
  ELSIF p_duplicate_rule = 'one_per_shop_per_am_per_day' THEN
    SELECT COUNT(*) INTO v_existing_count
    FROM public.roadtour_scan_events
    WHERE campaign_id = p_campaign_id
      AND account_manager_user_id = p_account_manager_user_id
      AND shop_id = p_shop_id
      AND scan_status = 'success'
      AND points_awarded > 0
      AND scan_time::date = CURRENT_DATE;
  ELSE
    v_existing_count := 0;
  END IF;

  IF v_existing_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'duplicate', 'message', 'Reward already claimed based on the duplicate prevention rule.');
  END IF;

  -- Get current balance (SELECT INTO sets NULL when 0 rows – guard explicitly)
  SELECT COALESCE(v.current_balance, 0) INTO v_balance
  FROM public.v_consumer_points_balance v
  WHERE v.user_id = p_scanned_by_user_id;

  IF v_balance IS NULL THEN
    v_balance := 0;
  END IF;

  -- Get phone/email
  SELECT u.phone, u.email INTO v_phone, v_email
  FROM public.users u WHERE u.id = p_scanned_by_user_id;

  v_description := format('RoadTour bonus — campaign scan reward (%s points)', p_points);

  -- Insert points transaction
  INSERT INTO public.points_transactions (
    company_id, consumer_phone, consumer_email,
    transaction_type, points_amount, balance_after,
    description, transaction_date, user_id, created_by
  ) VALUES (
    p_org_id, COALESCE(v_phone, ''), v_email,
    p_transaction_type, p_points, COALESCE(v_balance, 0) + COALESCE(p_points, 0),
    v_description, now(), p_scanned_by_user_id, p_scanned_by_user_id
  )
  RETURNING id INTO v_txn_id;

  -- Update scan event with reward
  IF p_scan_event_id IS NOT NULL THEN
    UPDATE public.roadtour_scan_events
    SET points_awarded = p_points, scan_status = 'success', reward_transaction_id = v_txn_id
    WHERE id = p_scan_event_id;
  END IF;

  -- Update survey response with reward
  IF p_survey_response_id IS NOT NULL THEN
    UPDATE public.roadtour_survey_responses
    SET points_awarded = p_points, reward_transaction_id = v_txn_id
    WHERE id = p_survey_response_id;
  END IF;

  -- Try to create official visit (ignore if duplicate constraint fires)
  BEGIN
    INSERT INTO public.roadtour_official_visits (
      campaign_id, account_manager_user_id, shop_id,
      official_scan_event_id, official_survey_response_id, visit_date
    ) VALUES (
      p_campaign_id, p_account_manager_user_id, p_shop_id,
      p_scan_event_id, p_survey_response_id, CURRENT_DATE
    );
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_txn_id,
    'points_awarded', p_points,
    'balance_after', COALESCE(v_balance, 0) + COALESCE(p_points, 0),
    'message', 'RoadTour reward credited successfully.'
  );
END;
$function$;
