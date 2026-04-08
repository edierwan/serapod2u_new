-- ============================================================================
-- Migration: RoadTour Module — Full Schema
-- Date: 2026-04-08
-- Purpose:
--   1. Extend points_transactions to support new transaction types
--   2. Create RoadTour settings, campaigns, QR, visits, survey, analytics tables
--   3. Enforce business rules via constraints, indexes, RLS
--   4. Support survey-based and direct reward flows
-- ============================================================================

-- ============================================================================
-- 0. EXTEND POINTS TRANSACTION TYPES
-- ============================================================================
-- Add 'registration', 'roadtour', 'roadtour_survey' to the existing CHECK constraint
ALTER TABLE public.points_transactions
  DROP CONSTRAINT IF EXISTS points_transactions_transaction_type_check;

ALTER TABLE public.points_transactions
  ADD CONSTRAINT points_transactions_transaction_type_check
  CHECK (transaction_type = ANY (ARRAY[
    'earn', 'redeem', 'expire', 'adjust', 'game_win', 'MIGRATION',
    'registration', 'roadtour', 'roadtour_survey'
  ]));

COMMENT ON CONSTRAINT points_transactions_transaction_type_check ON public.points_transactions IS
  'earn (QR scan), redeem (spend), expire (expired), adjust (manual), game_win (game), MIGRATION (legacy), registration (welcome bonus), roadtour (direct road tour reward), roadtour_survey (road tour survey reward)';

-- ============================================================================
-- A. ROADTOUR SETTINGS (org-level config)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  default_points integer NOT NULL DEFAULT 20 CHECK (default_points > 0),
  reward_mode text NOT NULL DEFAULT 'survey_submit' CHECK (reward_mode IN ('direct_scan', 'survey_submit')),
  survey_template_id uuid,   -- FK added after survey table created
  qr_mode text NOT NULL DEFAULT 'persistent' CHECK (qr_mode IN ('persistent', 'time_limited', 'one_time')),
  duplicate_rule_reward text NOT NULL DEFAULT 'one_per_user_per_campaign' CHECK (duplicate_rule_reward IN ('one_per_user_per_campaign', 'one_per_user_per_day', 'one_per_shop_per_am_per_day')),
  official_visit_rule text NOT NULL DEFAULT 'one_per_shop_per_am_per_day' CHECK (official_visit_rule IN ('one_per_shop_per_am_per_day', 'one_per_shop_per_campaign')),
  require_login boolean NOT NULL DEFAULT true,
  require_shop_context boolean NOT NULL DEFAULT true,
  require_geolocation boolean NOT NULL DEFAULT false,
  qr_expiry_hours integer,
  point_value_rm_snapshot numeric(10,4),
  whatsapp_send_enabled boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT uq_roadtour_settings_org UNIQUE (org_id)
);

CREATE INDEX IF NOT EXISTS idx_roadtour_settings_org ON public.roadtour_settings (org_id);

-- ============================================================================
-- B. ROADTOUR CAMPAIGNS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  region_scope jsonb,  -- e.g. ["Kedah","Penang"]
  default_points integer NOT NULL DEFAULT 20 CHECK (default_points > 0),
  reward_mode text NOT NULL DEFAULT 'survey_submit' CHECK (reward_mode IN ('direct_scan', 'survey_submit')),
  survey_template_id uuid,
  qr_mode text NOT NULL DEFAULT 'persistent' CHECK (qr_mode IN ('persistent', 'time_limited', 'one_time')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

CREATE INDEX IF NOT EXISTS idx_roadtour_campaigns_org_status ON public.roadtour_campaigns (org_id, status);
CREATE INDEX IF NOT EXISTS idx_roadtour_campaigns_dates ON public.roadtour_campaigns (start_date, end_date);

-- ============================================================================
-- C. ROADTOUR CAMPAIGN MANAGERS (assigned account managers)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_campaign_managers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.roadtour_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT uq_roadtour_campaign_manager UNIQUE (campaign_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_roadtour_campaign_managers_campaign ON public.roadtour_campaign_managers (campaign_id, is_active);
CREATE INDEX IF NOT EXISTS idx_roadtour_campaign_managers_user ON public.roadtour_campaign_managers (user_id, is_active);

-- ============================================================================
-- D. ROADTOUR SURVEY TEMPLATES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_survey_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

CREATE INDEX IF NOT EXISTS idx_roadtour_survey_templates_org ON public.roadtour_survey_templates (org_id, is_active);

-- ============================================================================
-- E. ROADTOUR SURVEY TEMPLATE FIELDS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_survey_template_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.roadtour_survey_templates(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  field_label text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN ('text', 'textarea', 'yes_no', 'single_select', 'multi_select', 'checkbox', 'radio', 'number', 'phone', 'photo')),
  field_options jsonb,   -- for select/radio: [{"label":"Opt A","value":"a"},...]
  is_required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  placeholder text,
  help_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roadtour_survey_fields_template ON public.roadtour_survey_template_fields (template_id, sort_order);

-- Now add FK from settings/campaigns to survey templates
ALTER TABLE public.roadtour_settings
  ADD CONSTRAINT fk_roadtour_settings_survey_template
  FOREIGN KEY (survey_template_id) REFERENCES public.roadtour_survey_templates(id) ON DELETE SET NULL;

ALTER TABLE public.roadtour_campaigns
  ADD CONSTRAINT fk_roadtour_campaigns_survey_template
  FOREIGN KEY (survey_template_id) REFERENCES public.roadtour_survey_templates(id) ON DELETE SET NULL;

-- ============================================================================
-- F. ROADTOUR QR CODES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_qr_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.roadtour_campaigns(id) ON DELETE CASCADE,
  account_manager_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  shop_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  qr_code text,          -- base64 encoded QR image or data URL
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'base64url'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  qr_mode text NOT NULL DEFAULT 'persistent' CHECK (qr_mode IN ('persistent', 'time_limited', 'one_time')),
  expires_at timestamptz,
  usage_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roadtour_qr_codes_campaign ON public.roadtour_qr_codes (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_roadtour_qr_codes_am ON public.roadtour_qr_codes (account_manager_user_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roadtour_qr_codes_token ON public.roadtour_qr_codes (token);
-- One active QR per AM per campaign (when no shop scope)
CREATE UNIQUE INDEX IF NOT EXISTS uq_roadtour_qr_am_campaign_active
  ON public.roadtour_qr_codes (campaign_id, account_manager_user_id)
  WHERE status = 'active' AND shop_id IS NULL;

-- ============================================================================
-- G. ROADTOUR QR DELIVERY LOGS (WhatsApp send)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_qr_delivery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.roadtour_campaigns(id) ON DELETE CASCADE,
  qr_code_id uuid NOT NULL REFERENCES public.roadtour_qr_codes(id) ON DELETE CASCADE,
  account_manager_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  send_status text NOT NULL DEFAULT 'pending' CHECK (send_status IN ('pending', 'sent', 'delivered', 'failed')),
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roadtour_delivery_logs_qr ON public.roadtour_qr_delivery_logs (qr_code_id);
CREATE INDEX IF NOT EXISTS idx_roadtour_delivery_logs_campaign ON public.roadtour_qr_delivery_logs (campaign_id);

-- ============================================================================
-- H. ROADTOUR SCAN EVENTS (all scan attempts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.roadtour_campaigns(id) ON DELETE CASCADE,
  qr_code_id uuid NOT NULL REFERENCES public.roadtour_qr_codes(id) ON DELETE CASCADE,
  account_manager_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scanned_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  shop_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  scan_status text NOT NULL DEFAULT 'opened' CHECK (scan_status IN ('success', 'duplicate', 'invalid', 'expired', 'rejected', 'opened')),
  points_awarded integer NOT NULL DEFAULT 0,
  reward_transaction_id uuid REFERENCES public.points_transactions(id) ON DELETE SET NULL,
  scan_time timestamptz NOT NULL DEFAULT now(),
  geolocation jsonb,   -- {"lat":x,"lng":y,"accuracy":z}
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roadtour_scan_events_campaign ON public.roadtour_scan_events (campaign_id, scan_time DESC);
CREATE INDEX IF NOT EXISTS idx_roadtour_scan_events_qr ON public.roadtour_scan_events (qr_code_id, scan_time DESC);
CREATE INDEX IF NOT EXISTS idx_roadtour_scan_events_user ON public.roadtour_scan_events (scanned_by_user_id, scan_time DESC);

-- ============================================================================
-- I. ROADTOUR OFFICIAL VISITS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_official_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.roadtour_campaigns(id) ON DELETE CASCADE,
  account_manager_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  official_scan_event_id uuid REFERENCES public.roadtour_scan_events(id) ON DELETE SET NULL,
  official_survey_response_id uuid,  -- FK added after survey responses table
  visit_date date NOT NULL DEFAULT CURRENT_DATE,
  visit_status text NOT NULL DEFAULT 'official' CHECK (visit_status IN ('official', 'duplicate', 'manual', 'cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Enforce: one official visit per shop per account manager per campaign per day
  CONSTRAINT uq_roadtour_official_visit UNIQUE (campaign_id, account_manager_user_id, shop_id, visit_date)
);

CREATE INDEX IF NOT EXISTS idx_roadtour_official_visits_campaign ON public.roadtour_official_visits (campaign_id, visit_date DESC);
CREATE INDEX IF NOT EXISTS idx_roadtour_official_visits_am ON public.roadtour_official_visits (account_manager_user_id, visit_date DESC);

-- ============================================================================
-- J. ROADTOUR SURVEY RESPONSES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.roadtour_campaigns(id) ON DELETE CASCADE,
  qr_code_id uuid NOT NULL REFERENCES public.roadtour_qr_codes(id) ON DELETE CASCADE,
  account_manager_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scanned_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  shop_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  scan_event_id uuid REFERENCES public.roadtour_scan_events(id) ON DELETE SET NULL,
  template_id uuid NOT NULL REFERENCES public.roadtour_survey_templates(id) ON DELETE CASCADE,
  response_status text NOT NULL DEFAULT 'submitted' CHECK (response_status IN ('submitted', 'rejected', 'draft')),
  submitted_at timestamptz,
  points_awarded integer NOT NULL DEFAULT 0,
  reward_transaction_id uuid REFERENCES public.points_transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roadtour_survey_responses_campaign ON public.roadtour_survey_responses (campaign_id);
CREATE INDEX IF NOT EXISTS idx_roadtour_survey_responses_user ON public.roadtour_survey_responses (scanned_by_user_id);

-- Now add FK to official visits
ALTER TABLE public.roadtour_official_visits
  ADD CONSTRAINT fk_roadtour_official_visits_survey
  FOREIGN KEY (official_survey_response_id) REFERENCES public.roadtour_survey_responses(id) ON DELETE SET NULL;

-- ============================================================================
-- K. ROADTOUR SURVEY RESPONSE ITEMS (individual field answers)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.roadtour_survey_response_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid NOT NULL REFERENCES public.roadtour_survey_responses(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  field_label_snapshot text,
  field_type_snapshot text,
  answer_text text,
  answer_json jsonb,
  answer_number numeric,
  media_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roadtour_survey_items_response ON public.roadtour_survey_response_items (response_id);

-- ============================================================================
-- TRIGGERS: updated_at auto-update
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at_roadtour()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'roadtour_settings',
    'roadtour_campaigns',
    'roadtour_qr_codes',
    'roadtour_survey_templates',
    'roadtour_survey_template_fields',
    'roadtour_survey_responses',
    'roadtour_official_visits'
  ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_roadtour()',
      t, t
    );
  END LOOP;
END;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'roadtour_settings',
    'roadtour_campaigns',
    'roadtour_campaign_managers',
    'roadtour_qr_codes',
    'roadtour_qr_delivery_logs',
    'roadtour_scan_events',
    'roadtour_official_visits',
    'roadtour_survey_templates',
    'roadtour_survey_template_fields',
    'roadtour_survey_responses',
    'roadtour_survey_response_items'
  ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Admin SELECT
    EXECUTE format(
      'DROP POLICY IF EXISTS %s_admin_select ON public.%I', t, t
    );
    EXECUTE format(
      'CREATE POLICY %s_admin_select ON public.%I FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid()
                AND u.role_code IN (''SA'', ''HQ'', ''POWER_USER'', ''HQ_ADMIN'', ''SUPER_ADMIN'', ''ADMIN''))
      )', t, t
    );

    -- Admin MANAGE (insert/update/delete)
    EXECUTE format(
      'DROP POLICY IF EXISTS %s_admin_manage ON public.%I', t, t
    );
    EXECUTE format(
      'CREATE POLICY %s_admin_manage ON public.%I FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid()
                AND u.role_code IN (''SA'', ''HQ'', ''POWER_USER'', ''HQ_ADMIN'', ''SUPER_ADMIN'', ''ADMIN''))
      ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid()
                AND u.role_code IN (''SA'', ''HQ'', ''POWER_USER'', ''HQ_ADMIN'', ''SUPER_ADMIN'', ''ADMIN''))
      )', t, t
    );
  END LOOP;
END;
$$;

-- Allow account managers to see their own assignments
CREATE POLICY roadtour_campaign_managers_self_select
ON public.roadtour_campaign_managers
FOR SELECT
USING (user_id = auth.uid());

-- Allow consumers/end-users to see scan events and survey responses they created
CREATE POLICY roadtour_scan_events_self_select
ON public.roadtour_scan_events
FOR SELECT
USING (scanned_by_user_id = auth.uid());

CREATE POLICY roadtour_survey_responses_self_select
ON public.roadtour_survey_responses
FOR SELECT
USING (scanned_by_user_id = auth.uid());

CREATE POLICY roadtour_survey_responses_self_insert
ON public.roadtour_survey_responses
FOR INSERT
WITH CHECK (scanned_by_user_id = auth.uid());

CREATE POLICY roadtour_survey_response_items_self_insert
ON public.roadtour_survey_response_items
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.roadtour_survey_responses r
    WHERE r.id = response_id AND r.scanned_by_user_id = auth.uid()
  )
);

CREATE POLICY roadtour_survey_response_items_self_select
ON public.roadtour_survey_response_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.roadtour_survey_responses r
    WHERE r.id = response_id AND r.scanned_by_user_id = auth.uid()
  )
);

-- Consumers can read active survey templates (to render form)
CREATE POLICY roadtour_survey_templates_public_select
ON public.roadtour_survey_templates
FOR SELECT
USING (is_active = true);

CREATE POLICY roadtour_survey_template_fields_public_select
ON public.roadtour_survey_template_fields
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.roadtour_survey_templates t
    WHERE t.id = template_id AND t.is_active = true
  )
);

-- ============================================================================
-- GRANTS
-- ============================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'roadtour_settings',
    'roadtour_campaigns',
    'roadtour_campaign_managers',
    'roadtour_qr_codes',
    'roadtour_qr_delivery_logs',
    'roadtour_scan_events',
    'roadtour_official_visits',
    'roadtour_survey_templates',
    'roadtour_survey_template_fields',
    'roadtour_survey_responses',
    'roadtour_survey_response_items'
  ])
  LOOP
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END;
$$;

-- ============================================================================
-- DEFAULT ROADTOUR SURVEY TEMPLATE
-- ============================================================================
-- This creates a default template that can be linked from settings
-- Orgs should insert their own; this is a convenience seed

-- We wrap in a DO block so it's idempotent
DO $$
DECLARE
  v_template_id uuid;
BEGIN
  -- Only create if no template exists yet for any org
  IF NOT EXISTS (SELECT 1 FROM public.roadtour_survey_templates LIMIT 1) THEN
    INSERT INTO public.roadtour_survey_templates (name, description, org_id, is_active)
    VALUES (
      'Default RoadTour Survey',
      'Standard field visit survey for road tour activities.',
      (SELECT id FROM public.organizations WHERE org_type_code = 'HQ' LIMIT 1),
      true
    )
    RETURNING id INTO v_template_id;

    IF v_template_id IS NOT NULL THEN
      INSERT INTO public.roadtour_survey_template_fields (template_id, field_key, field_label, field_type, is_required, sort_order, field_options) VALUES
        (v_template_id, 'selling_serapod', 'Is this shop currently selling Serapod products?', 'yes_no', true, 1, NULL),
        (v_template_id, 'available_products', 'Which products are currently available?', 'multi_select', false, 2,
         '[{"label":"Serapod Classic","value":"classic"},{"label":"Serapod Pro","value":"pro"},{"label":"Serapod Mini","value":"mini"},{"label":"Accessories","value":"accessories"}]'::jsonb),
        (v_template_id, 'stock_issue', 'Any stock issue today?', 'yes_no', true, 3, NULL),
        (v_template_id, 'interested_promo', 'Interested in new promotion?', 'yes_no', false, 4, NULL),
        (v_template_id, 'shop_pic_name', 'Shop PIC Name', 'text', false, 5, NULL),
        (v_template_id, 'shop_pic_phone', 'Shop PIC Phone Number', 'phone', false, 6, NULL),
        (v_template_id, 'remarks', 'Remarks', 'textarea', false, 7, NULL);
    END IF;
  END IF;
END;
$$;

-- ============================================================================
-- HELPER FUNCTION: Validate RoadTour QR token
-- Returns campaign and AM details for a given token
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
    'survey_template_id', v_campaign.survey_template_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_roadtour_qr_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_roadtour_qr_token(text) TO service_role;

-- ============================================================================
-- HELPER FUNCTION: Record RoadTour reward (idempotent)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.record_roadtour_reward(
  p_org_id uuid,
  p_campaign_id uuid,
  p_qr_code_id uuid,
  p_account_manager_user_id uuid,
  p_scanned_by_user_id uuid,
  p_shop_id uuid,
  p_points integer,
  p_scan_event_id uuid DEFAULT NULL,
  p_survey_response_id uuid DEFAULT NULL,
  p_duplicate_rule text DEFAULT 'one_per_user_per_campaign',
  p_transaction_type text DEFAULT 'roadtour'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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

  -- Get current balance
  SELECT COALESCE(v.current_balance, 0) INTO v_balance
  FROM public.v_consumer_points_balance v
  WHERE v.user_id = p_scanned_by_user_id;

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
    p_transaction_type, p_points, v_balance + p_points,
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
    -- Already have an official visit for this combo today, that's fine
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_txn_id,
    'points_awarded', p_points,
    'balance_after', v_balance + p_points,
    'message', 'RoadTour reward credited successfully.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_roadtour_reward(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_roadtour_reward(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,uuid,text,text) TO service_role;
