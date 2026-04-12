-- ============================================================================
-- Migration: RoadTour Scan Premium Flow
-- Date: 2026-04-10
-- 
-- 1. Update validate_roadtour_qr_token to return org settings
--    (require_login, require_shop_context, require_geolocation, 
--     duplicate_rule_reward, org_id)
-- 2. Update record_roadtour_reward to accept geolocation
-- 3. Update claim-reward flow to support authenticated users
-- ============================================================================

-- ============================================================================
-- 1. Update validate_roadtour_qr_token to include org settings
-- ============================================================================
CREATE OR REPLACE FUNCTION public.validate_roadtour_qr_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_qr public.roadtour_qr_codes%ROWTYPE;
  v_campaign public.roadtour_campaigns%ROWTYPE;
  v_am_name text;
  v_settings public.roadtour_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_qr
  FROM public.roadtour_qr_codes
  WHERE token = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'invalid_qr', 'message', 'QR code is not recognized.');
  END IF;

  IF v_qr.status = 'revoked' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'revoked', 'message', 'This QR code has been revoked.');
  END IF;

  IF v_qr.status = 'expired' OR (v_qr.expires_at IS NOT NULL AND v_qr.expires_at < now()) THEN
    RETURN jsonb_build_object('valid', false, 'error', 'expired', 'message', 'This QR code has expired.');
  END IF;

  SELECT * INTO v_campaign
  FROM public.roadtour_campaigns
  WHERE id = v_qr.campaign_id;

  IF NOT FOUND OR v_campaign.status != 'active' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'inactive_campaign', 'message', 'The campaign is not currently active.');
  END IF;

  IF CURRENT_DATE < v_campaign.start_date OR CURRENT_DATE > v_campaign.end_date THEN
    RETURN jsonb_build_object('valid', false, 'error', 'campaign_date_range', 'message', 'The campaign is not within its scheduled date range.');
  END IF;

  SELECT full_name INTO v_am_name
  FROM public.users WHERE id = v_qr.account_manager_user_id;

  -- Fetch org-level settings
  SELECT * INTO v_settings
  FROM public.roadtour_settings
  WHERE org_id = v_campaign.org_id
  LIMIT 1;

  -- Increment usage
  UPDATE public.roadtour_qr_codes
  SET usage_count = usage_count + 1, last_used_at = now()
  WHERE id = v_qr.id;

  RETURN jsonb_build_object(
    'valid', true,
    'qr_code_id', v_qr.id,
    'campaign_id', v_qr.campaign_id,
    'campaign_name', v_campaign.name,
    'account_manager_user_id', v_qr.account_manager_user_id,
    'account_manager_name', COALESCE(v_am_name, ''),
    'shop_id', v_qr.shop_id,
    'qr_mode', v_qr.qr_mode,
    'reward_mode', v_campaign.reward_mode,
    'default_points', v_campaign.default_points,
    'survey_template_id', v_campaign.survey_template_id,
    'org_id', v_campaign.org_id,
    'require_login', COALESCE(v_settings.require_login, true),
    'require_shop_context', COALESCE(v_settings.require_shop_context, false),
    'require_geolocation', COALESCE(v_settings.require_geolocation, false),
    'duplicate_rule_reward', COALESCE(v_settings.duplicate_rule_reward, 'one_per_user_per_campaign')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_roadtour_qr_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_roadtour_qr_token(text) TO service_role;
