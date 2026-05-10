-- ============================================================================
-- Migration: RoadTour hardening and org-scoped RLS
-- Date: 2026-05-10
--
-- Changes:
-- 1. Add helper functions for RoadTour admin authorization.
-- 2. Replace RoadTour admin policies with org-scoped variants.
-- 3. Add explicit RLS coverage for roadtour_claim_notification_logs.
-- 4. Enforce survey template presence for new survey-submit campaigns.
-- 5. Stop QR validation from inflating usage_count on page load.
-- 6. Add a helper function to record QR usage on actual claim attempts.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_roadtour_global_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role_code IN ('SA', 'HQ', 'HQ_ADMIN', 'SUPER_ADMIN')
  );
$$;

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

CREATE OR REPLACE FUNCTION public.record_roadtour_qr_usage(p_qr_code_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.roadtour_qr_codes
  SET usage_count = COALESCE(usage_count, 0) + 1,
      last_used_at = now()
  WHERE id = p_qr_code_id;
$$;

GRANT EXECUTE ON FUNCTION public.record_roadtour_qr_usage(uuid) TO authenticated;

ALTER TABLE public.roadtour_claim_notification_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roadtour_settings_admin_select ON public.roadtour_settings;
DROP POLICY IF EXISTS roadtour_settings_admin_manage ON public.roadtour_settings;
CREATE POLICY roadtour_settings_admin_select
ON public.roadtour_settings
FOR SELECT
USING (public.is_roadtour_org_admin(org_id));
CREATE POLICY roadtour_settings_admin_manage
ON public.roadtour_settings
FOR ALL
USING (public.is_roadtour_org_admin(org_id))
WITH CHECK (public.is_roadtour_org_admin(org_id));

DROP POLICY IF EXISTS roadtour_campaigns_admin_select ON public.roadtour_campaigns;
DROP POLICY IF EXISTS roadtour_campaigns_admin_manage ON public.roadtour_campaigns;
CREATE POLICY roadtour_campaigns_admin_select
ON public.roadtour_campaigns
FOR SELECT
USING (public.is_roadtour_org_admin(org_id));
CREATE POLICY roadtour_campaigns_admin_manage
ON public.roadtour_campaigns
FOR ALL
USING (public.is_roadtour_org_admin(org_id))
WITH CHECK (public.is_roadtour_org_admin(org_id));

DROP POLICY IF EXISTS roadtour_campaign_managers_admin_select ON public.roadtour_campaign_managers;
DROP POLICY IF EXISTS roadtour_campaign_managers_admin_manage ON public.roadtour_campaign_managers;
CREATE POLICY roadtour_campaign_managers_admin_select
ON public.roadtour_campaign_managers
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);
CREATE POLICY roadtour_campaign_managers_admin_manage
ON public.roadtour_campaign_managers
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);

DROP POLICY IF EXISTS roadtour_qr_codes_admin_select ON public.roadtour_qr_codes;
DROP POLICY IF EXISTS roadtour_qr_codes_admin_manage ON public.roadtour_qr_codes;
CREATE POLICY roadtour_qr_codes_admin_select
ON public.roadtour_qr_codes
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);
CREATE POLICY roadtour_qr_codes_admin_manage
ON public.roadtour_qr_codes
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);

DROP POLICY IF EXISTS roadtour_qr_delivery_logs_admin_select ON public.roadtour_qr_delivery_logs;
DROP POLICY IF EXISTS roadtour_qr_delivery_logs_admin_manage ON public.roadtour_qr_delivery_logs;
CREATE POLICY roadtour_qr_delivery_logs_admin_select
ON public.roadtour_qr_delivery_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);
CREATE POLICY roadtour_qr_delivery_logs_admin_manage
ON public.roadtour_qr_delivery_logs
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);

DROP POLICY IF EXISTS roadtour_scan_events_admin_select ON public.roadtour_scan_events;
DROP POLICY IF EXISTS roadtour_scan_events_admin_manage ON public.roadtour_scan_events;
CREATE POLICY roadtour_scan_events_admin_select
ON public.roadtour_scan_events
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);
CREATE POLICY roadtour_scan_events_admin_manage
ON public.roadtour_scan_events
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);

DROP POLICY IF EXISTS roadtour_official_visits_admin_select ON public.roadtour_official_visits;
DROP POLICY IF EXISTS roadtour_official_visits_admin_manage ON public.roadtour_official_visits;
CREATE POLICY roadtour_official_visits_admin_select
ON public.roadtour_official_visits
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);
CREATE POLICY roadtour_official_visits_admin_manage
ON public.roadtour_official_visits
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);

DROP POLICY IF EXISTS roadtour_survey_templates_admin_select ON public.roadtour_survey_templates;
DROP POLICY IF EXISTS roadtour_survey_templates_admin_manage ON public.roadtour_survey_templates;
CREATE POLICY roadtour_survey_templates_admin_select
ON public.roadtour_survey_templates
FOR SELECT
USING (public.is_roadtour_org_admin(org_id));
CREATE POLICY roadtour_survey_templates_admin_manage
ON public.roadtour_survey_templates
FOR ALL
USING (public.is_roadtour_org_admin(org_id))
WITH CHECK (public.is_roadtour_org_admin(org_id));

DROP POLICY IF EXISTS roadtour_survey_template_fields_admin_select ON public.roadtour_survey_template_fields;
DROP POLICY IF EXISTS roadtour_survey_template_fields_admin_manage ON public.roadtour_survey_template_fields;
CREATE POLICY roadtour_survey_template_fields_admin_select
ON public.roadtour_survey_template_fields
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_survey_templates t
    WHERE t.id = template_id
      AND public.is_roadtour_org_admin(t.org_id)
  )
);
CREATE POLICY roadtour_survey_template_fields_admin_manage
ON public.roadtour_survey_template_fields
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_survey_templates t
    WHERE t.id = template_id
      AND public.is_roadtour_org_admin(t.org_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.roadtour_survey_templates t
    WHERE t.id = template_id
      AND public.is_roadtour_org_admin(t.org_id)
  )
);

DROP POLICY IF EXISTS roadtour_survey_responses_admin_select ON public.roadtour_survey_responses;
DROP POLICY IF EXISTS roadtour_survey_responses_admin_manage ON public.roadtour_survey_responses;
CREATE POLICY roadtour_survey_responses_admin_select
ON public.roadtour_survey_responses
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);
CREATE POLICY roadtour_survey_responses_admin_manage
ON public.roadtour_survey_responses
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);

DROP POLICY IF EXISTS roadtour_survey_response_items_admin_select ON public.roadtour_survey_response_items;
DROP POLICY IF EXISTS roadtour_survey_response_items_admin_manage ON public.roadtour_survey_response_items;
CREATE POLICY roadtour_survey_response_items_admin_select
ON public.roadtour_survey_response_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_survey_responses r
    JOIN public.roadtour_campaigns c ON c.id = r.campaign_id
    WHERE r.id = response_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);
CREATE POLICY roadtour_survey_response_items_admin_manage
ON public.roadtour_survey_response_items
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_survey_responses r
    JOIN public.roadtour_campaigns c ON c.id = r.campaign_id
    WHERE r.id = response_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.roadtour_survey_responses r
    JOIN public.roadtour_campaigns c ON c.id = r.campaign_id
    WHERE r.id = response_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);

DROP POLICY IF EXISTS roadtour_claim_notification_logs_admin_select ON public.roadtour_claim_notification_logs;
DROP POLICY IF EXISTS roadtour_claim_notification_logs_admin_manage ON public.roadtour_claim_notification_logs;
CREATE POLICY roadtour_claim_notification_logs_admin_select
ON public.roadtour_claim_notification_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);
CREATE POLICY roadtour_claim_notification_logs_admin_manage
ON public.roadtour_claim_notification_logs
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.roadtour_campaigns c
    WHERE c.id = campaign_id
      AND public.is_roadtour_org_admin(c.org_id)
  )
);

ALTER TABLE public.roadtour_campaigns
  DROP CONSTRAINT IF EXISTS roadtour_campaigns_survey_template_required;

ALTER TABLE public.roadtour_campaigns
  ADD CONSTRAINT roadtour_campaigns_survey_template_required
  CHECK (reward_mode <> 'survey_submit' OR survey_template_id IS NOT NULL)
  NOT VALID;

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
  FROM public.users
  WHERE id = v_qr.account_manager_user_id;

  SELECT * INTO v_settings
  FROM public.roadtour_settings
  WHERE org_id = v_campaign.org_id
  LIMIT 1;

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