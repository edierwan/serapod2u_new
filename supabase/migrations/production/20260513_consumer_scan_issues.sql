-- ============================================================================
-- Consumer Scan Issues — track failed QR scan attempts for support follow-up
-- Created: 2026-05-13
--
-- Purpose:
--   1) Every failed collect-points / scan attempt is logged into
--      public.consumer_scan_issues with enough context for support to act and
--      for time-series reporting.
--   2) Templates + settings tables drive WhatsApp consumer acknowledgements
--      and admin alerts via the existing Baileys/Getouch gateway.
--
-- Naming: snake_case, plural table names, RLS enabled. Mirrors patterns from
--   20260408_roadtour.sql and 20260415_marketing_daily_reporting_inbound.sql.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) consumer_scan_issues — main fact table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consumer_scan_issues (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_no           text UNIQUE,                                -- generated below
  org_id             uuid NULL,                                  -- HQ org owning the order, when resolvable

  -- QR / order linkage (nullable — issues may exist even when QR is unknown)
  qr_code_text       text NOT NULL,
  qr_code_id         uuid NULL REFERENCES public.qr_codes(id) ON DELETE SET NULL,
  master_code_id     uuid NULL REFERENCES public.qr_master_codes(id) ON DELETE SET NULL,
  order_id           uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  product_id         uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  shop_id            uuid NULL,
  consumer_user_id   uuid NULL,

  -- Snapshot fields — values are frozen at the moment of the failed scan
  order_no_snapshot          text NULL,
  display_doc_no_snapshot    text NULL,
  master_code_snapshot       text NULL,
  product_code_snapshot      text NULL,
  product_name_snapshot      text NULL,
  shop_name_snapshot         text NULL,
  consumer_name_snapshot     text NULL,
  consumer_phone_snapshot    text NULL,
  consumer_email_snapshot    text NULL,

  -- Issue classification
  issue_type         text NOT NULL,
  error_code         text NULL,
  error_message      text NOT NULL,
  user_facing_message text NULL,
  status             text NOT NULL DEFAULT 'pending',
  priority           text NOT NULL DEFAULT 'medium',

  -- Time fields
  scan_attempted_at  timestamptz NOT NULL DEFAULT now(),
  -- generated columns for fast time-series reporting in Asia/Kuala_Lumpur
  scan_date          date         GENERATED ALWAYS AS ((scan_attempted_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date) STORED,
  scan_hour          smallint     GENERATED ALWAYS AS (EXTRACT(HOUR  FROM (scan_attempted_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::smallint) STORED,
  scan_day_of_week   smallint     GENERATED ALWAYS AS (EXTRACT(DOW   FROM (scan_attempted_at AT TIME ZONE 'Asia/Kuala_Lumpur'))::smallint) STORED,
  timezone           text NOT NULL DEFAULT 'Asia/Kuala_Lumpur',

  -- Request / device metadata
  source_page        text NULL,
  scan_url           text NULL,
  ip_address         inet NULL,
  user_agent         text NULL,
  device_type        text NULL,
  browser            text NULL,
  os                 text NULL,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Duplicate-attempt counters (we update existing pending issues rather than spam)
  attempt_count      integer NOT NULL DEFAULT 1,
  last_attempt_at    timestamptz NOT NULL DEFAULT now(),

  -- Consumer notification (acknowledgement)
  notify_consumer_enabled        boolean NOT NULL DEFAULT true,
  consumer_whatsapp_number       text NULL,
  consumer_notification_status   text NOT NULL DEFAULT 'not_sent',
  consumer_notification_template_key text NULL,
  consumer_notification_sent_at  timestamptz NULL,
  consumer_notification_error    text NULL,

  -- Admin notification
  admin_notification_status      text NOT NULL DEFAULT 'not_sent',
  admin_notification_sent_at     timestamptz NULL,
  admin_notification_error       text NULL,

  -- Resolution workflow
  resolved_at        timestamptz NULL,
  resolved_by        uuid NULL,
  resolution_note    text NULL,
  rectified_at       timestamptz NULL,
  rectified_by       uuid NULL,
  rescan_notification_sent_at    timestamptz NULL,
  rescan_notification_status     text NOT NULL DEFAULT 'not_sent',

  -- Audit
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT consumer_scan_issues_status_chk
    CHECK (status IN ('pending','in_progress','resolved','ignored')),
  CONSTRAINT consumer_scan_issues_priority_chk
    CHECK (priority IN ('low','medium','high','urgent')),
  CONSTRAINT consumer_scan_issues_consumer_notification_status_chk
    CHECK (consumer_notification_status IN ('not_sent','sent','failed','skipped')),
  CONSTRAINT consumer_scan_issues_admin_notification_status_chk
    CHECK (admin_notification_status IN ('not_sent','sent','failed','skipped')),
  CONSTRAINT consumer_scan_issues_rescan_notification_status_chk
    CHECK (rescan_notification_status IN ('not_sent','sent','failed','skipped'))
);

COMMENT ON TABLE  public.consumer_scan_issues IS 'Failed/problematic QR scan attempts. One row per logical issue; attempt_count grows on repeat attempts within the dedup window.';
COMMENT ON COLUMN public.consumer_scan_issues.issue_no IS 'Human-readable id, e.g. SI-260513-0001';
COMMENT ON COLUMN public.consumer_scan_issues.issue_type IS 'Examples: not_shipped_yet, qr_not_found, qr_not_active, already_collected, expired_qr, blocked_qr, invalid_status, authentication_failed, system_error, unknown_error, buffer_unpromoted';
COMMENT ON COLUMN public.consumer_scan_issues.attempt_count IS 'Number of times the same consumer+QR+issue_type combo has been seen while the issue is still pending';

-- Indexes for reporting + support queries
CREATE INDEX IF NOT EXISTS idx_csi_scan_attempted_at         ON public.consumer_scan_issues (scan_attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_csi_status                    ON public.consumer_scan_issues (status);
CREATE INDEX IF NOT EXISTS idx_csi_issue_type                ON public.consumer_scan_issues (issue_type);
CREATE INDEX IF NOT EXISTS idx_csi_priority                  ON public.consumer_scan_issues (priority);
CREATE INDEX IF NOT EXISTS idx_csi_order_id                  ON public.consumer_scan_issues (order_id)              WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_csi_qr_code_id                ON public.consumer_scan_issues (qr_code_id)            WHERE qr_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_csi_qr_code_text              ON public.consumer_scan_issues (qr_code_text);
CREATE INDEX IF NOT EXISTS idx_csi_consumer_whatsapp_number  ON public.consumer_scan_issues (consumer_whatsapp_number) WHERE consumer_whatsapp_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_csi_scan_date                 ON public.consumer_scan_issues (scan_date DESC);
CREATE INDEX IF NOT EXISTS idx_csi_org_id                    ON public.consumer_scan_issues (org_id)                WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_csi_type_status               ON public.consumer_scan_issues (issue_type, status);
CREATE INDEX IF NOT EXISTS idx_csi_status_priority_attempted ON public.consumer_scan_issues (status, priority, scan_attempted_at DESC);
-- Dedup helper: find recent pending issues quickly
CREATE INDEX IF NOT EXISTS idx_csi_dedup_pending
  ON public.consumer_scan_issues (qr_code_text, consumer_whatsapp_number, issue_type, status, last_attempt_at DESC);

-- Issue-no generator: SI-YYMMDD-NNNN per UTC day. Done via per-day sequence in metadata.
CREATE OR REPLACE FUNCTION public.consumer_scan_issues_set_issue_no()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_date_part text;
  v_count     integer;
BEGIN
  IF NEW.issue_no IS NOT NULL AND NEW.issue_no <> '' THEN
    RETURN NEW;
  END IF;
  v_date_part := to_char((NEW.scan_attempted_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date, 'YYMMDD');
  SELECT COUNT(*) + 1 INTO v_count
    FROM public.consumer_scan_issues
   WHERE issue_no LIKE 'SI-' || v_date_part || '-%';
  NEW.issue_no := 'SI-' || v_date_part || '-' || lpad(v_count::text, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consumer_scan_issues_set_issue_no ON public.consumer_scan_issues;
CREATE TRIGGER trg_consumer_scan_issues_set_issue_no
BEFORE INSERT ON public.consumer_scan_issues
FOR EACH ROW EXECUTE FUNCTION public.consumer_scan_issues_set_issue_no();

CREATE OR REPLACE FUNCTION public.consumer_scan_issues_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consumer_scan_issues_touch_updated_at ON public.consumer_scan_issues;
CREATE TRIGGER trg_consumer_scan_issues_touch_updated_at
BEFORE UPDATE ON public.consumer_scan_issues
FOR EACH ROW EXECUTE FUNCTION public.consumer_scan_issues_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2) consumer_scan_issue_templates — WhatsApp message templates
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consumer_scan_issue_templates (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          uuid NULL,
  template_key    text NOT NULL,
  template_name   text NOT NULL,
  channel         text NOT NULL DEFAULT 'whatsapp',
  recipient_type  text NOT NULL,
  body            text NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT csit_recipient_type_chk CHECK (recipient_type IN ('consumer','admin')),
  CONSTRAINT csit_channel_chk        CHECK (channel = 'whatsapp'),
  CONSTRAINT csit_org_key_unique     UNIQUE (org_id, template_key)
);

CREATE INDEX IF NOT EXISTS idx_csit_org_active ON public.consumer_scan_issue_templates (org_id, is_active);

DROP TRIGGER IF EXISTS trg_csit_touch_updated_at ON public.consumer_scan_issue_templates;
CREATE TRIGGER trg_csit_touch_updated_at
BEFORE UPDATE ON public.consumer_scan_issue_templates
FOR EACH ROW EXECUTE FUNCTION public.consumer_scan_issues_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3) consumer_scan_issue_settings — admin WhatsApp recipients + triggers
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consumer_scan_issue_settings (
  org_id                       uuid PRIMARY KEY,
  admin_whatsapp_numbers       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- array of normalized E.164 (no '+')
  notify_on_new_issue          boolean NOT NULL DEFAULT true,
  notify_on_high_priority      boolean NOT NULL DEFAULT true,
  notify_on_status_change      boolean NOT NULL DEFAULT false,
  notify_on_resolved           boolean NOT NULL DEFAULT false,
  consumer_dedup_window_minutes integer NOT NULL DEFAULT 60,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_csis_touch_updated_at ON public.consumer_scan_issue_settings;
CREATE TRIGGER trg_csis_touch_updated_at
BEFORE UPDATE ON public.consumer_scan_issue_settings
FOR EACH ROW EXECUTE FUNCTION public.consumer_scan_issues_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4) Seed default templates (org_id IS NULL = global defaults / fallback)
-- ----------------------------------------------------------------------------
INSERT INTO public.consumer_scan_issue_templates (org_id, template_key, template_name, recipient_type, body, is_active)
VALUES
  (NULL, 'issue_acknowledgement', 'Issue Acknowledgement', 'consumer',
'Hi {{name}},
We noticed you tried to scan your QR code {{qr_code}} for order {{order_no}}.

Our team is aware of the issue: {{issue_type}}.
We are checking it and will update you once it has been rectified.

Thank you for your patience.
- Serapod2U Team', true),
  (NULL, 'issue_resolved_rescan', 'Issue Resolved / Please Scan Again', 'consumer',
'Hi {{name}},
Good news. The issue with your QR code {{qr_code}} has been rectified.

You may now scan again to collect your points:
{{rescan_link}}

Thank you.
- Serapod2U Team', true),
  (NULL, 'general_reminder', 'General Reminder', 'consumer',
'Hi {{name}},
Just checking in regarding your scan issue {{issue_no}}.
{{support_note}}

- Serapod2U Team', true),
  (NULL, 'admin_new_issue_alert', 'Admin New Issue Alert', 'admin',
'New Scan Issue Alert

Issue: {{issue_no}}
Type: {{issue_type}}
Priority: {{priority}}
QR: {{qr_code}}
Order: {{order_no}}
Consumer: {{consumer_phone}}
Error: {{error_message}}
Time: {{scan_time}}

Please review in Scan Issues.', true)
ON CONFLICT (org_id, template_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5) RLS — HQ/Admin/Power User can read & manage. Public access via service role only.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'consumer_scan_issues',
    'consumer_scan_issue_templates',
    'consumer_scan_issue_settings'
  ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %s_admin_select ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %s_admin_select ON public.%I FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid()
                AND u.role_code IN (''SA'',''HQ'',''POWER_USER'',''HQ_ADMIN'',''SUPER_ADMIN'',''ADMIN''))
      )', t, t);

    EXECUTE format('DROP POLICY IF EXISTS %s_admin_manage ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %s_admin_manage ON public.%I FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid()
                AND u.role_code IN (''SA'',''HQ'',''POWER_USER'',''HQ_ADMIN'',''SUPER_ADMIN'',''ADMIN''))
      ) WITH CHECK (
        EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid()
                AND u.role_code IN (''SA'',''HQ'',''POWER_USER'',''HQ_ADMIN'',''SUPER_ADMIN'',''ADMIN''))
      )', t, t);
  END LOOP;
END;
$$;

-- Consumers can SELECT their own issues (matched by consumer_user_id) — read only
DROP POLICY IF EXISTS consumer_scan_issues_self_select ON public.consumer_scan_issues;
CREATE POLICY consumer_scan_issues_self_select
ON public.consumer_scan_issues
FOR SELECT
USING (consumer_user_id = auth.uid());

COMMIT;
