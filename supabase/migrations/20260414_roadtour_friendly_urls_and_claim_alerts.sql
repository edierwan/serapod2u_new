-- RoadTour friendly URL persistence and claim alert configuration

ALTER TABLE public.roadtour_qr_codes
  ADD COLUMN IF NOT EXISTS route_year integer,
  ADD COLUMN IF NOT EXISTS campaign_slug text,
  ADD COLUMN IF NOT EXISTS reference_slug text,
  ADD COLUMN IF NOT EXISTS short_code text,
  ADD COLUMN IF NOT EXISTS canonical_path text;

ALTER TABLE public.roadtour_settings
  ADD COLUMN IF NOT EXISTS claim_whatsapp_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claim_whatsapp_recipient_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS claim_whatsapp_manual_numbers text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS claim_whatsapp_success_template text,
  ADD COLUMN IF NOT EXISTS claim_whatsapp_failure_template text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'roadtour_settings_claim_whatsapp_recipient_mode_check'
      AND conrelid = 'public.roadtour_settings'::regclass
  ) THEN
    ALTER TABLE public.roadtour_settings
      ADD CONSTRAINT roadtour_settings_claim_whatsapp_recipient_mode_check
      CHECK (claim_whatsapp_recipient_mode IN ('manual', 'hq_org'));
  END IF;
END $$;

UPDATE public.roadtour_settings
SET claim_whatsapp_success_template = COALESCE(
      claim_whatsapp_success_template,
      'RoadTour claim success\nCampaign: {campaign_name}\nShop: {shop_name}\nReference: {reference_name}\nConsumer: {consumer_name}\nPoints: {points_awarded}\nBalance: {balance_after}\nStatus: {status}'
    ),
    claim_whatsapp_failure_template = COALESCE(
      claim_whatsapp_failure_template,
      'RoadTour claim {status}\nCampaign: {campaign_name}\nShop: {shop_name}\nReference: {reference_name}\nConsumer: {consumer_name}\nReason: {message}'
    )
WHERE claim_whatsapp_success_template IS NULL
   OR claim_whatsapp_failure_template IS NULL;

CREATE OR REPLACE FUNCTION public.slugify_roadtour_segment(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    NULLIF(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(trim(COALESCE(p_value, ''))), '[_\s]+', '-', 'g'),
          '[^a-z0-9-]', '', 'g'
        ),
        '-+', '-', 'g'
      ),
      ''
    ),
    'untitled'
  )
$$;

CREATE OR REPLACE FUNCTION public.sync_roadtour_qr_route_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_campaign_name text;
  v_start_date date;
  v_reference_name text;
  v_year integer;
  v_campaign_slug text;
  v_reference_slug text;
  v_short_code text;
BEGIN
  SELECT c.name, c.start_date
    INTO v_campaign_name, v_start_date
  FROM public.roadtour_campaigns c
  WHERE c.id = NEW.campaign_id;

  SELECT COALESCE(u.full_name, u.phone, NEW.token)
    INTO v_reference_name
  FROM public.users u
  WHERE u.id = NEW.account_manager_user_id;

  v_year := COALESCE(EXTRACT(YEAR FROM v_start_date)::integer, EXTRACT(YEAR FROM NEW.created_at)::integer, EXTRACT(YEAR FROM now())::integer);
  v_campaign_slug := public.slugify_roadtour_segment(v_campaign_name);
  v_reference_slug := public.slugify_roadtour_segment(v_reference_name);
  v_short_code := lower(substr(regexp_replace(COALESCE(NEW.token, ''), '[^a-zA-Z0-9]', '', 'g'), 1, 8));
  IF v_short_code = '' THEN
    v_short_code := substr(md5(COALESCE(NEW.id::text, clock_timestamp()::text)), 1, 8);
  END IF;

  NEW.route_year := v_year;
  NEW.campaign_slug := v_campaign_slug;
  NEW.reference_slug := v_reference_slug;
  NEW.short_code := v_short_code;
  NEW.canonical_path := '/roadtour/' || v_year::text || '/' || v_campaign_slug || '/' || v_reference_slug || '-' || v_short_code;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roadtour_qr_route_fields ON public.roadtour_qr_codes;
CREATE TRIGGER trg_roadtour_qr_route_fields
BEFORE INSERT OR UPDATE OF campaign_id, account_manager_user_id, token
ON public.roadtour_qr_codes
FOR EACH ROW
EXECUTE FUNCTION public.sync_roadtour_qr_route_fields();

UPDATE public.roadtour_qr_codes q
SET updated_at = now()
WHERE q.route_year IS NULL
   OR q.campaign_slug IS NULL
   OR q.reference_slug IS NULL
   OR q.short_code IS NULL
   OR q.canonical_path IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_roadtour_qr_codes_short_code
  ON public.roadtour_qr_codes (short_code)
  WHERE short_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_roadtour_qr_codes_canonical_path
  ON public.roadtour_qr_codes (canonical_path)
  WHERE canonical_path IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.roadtour_claim_notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_event_id uuid REFERENCES public.roadtour_scan_events(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.roadtour_campaigns(id) ON DELETE CASCADE,
  qr_code_id uuid REFERENCES public.roadtour_qr_codes(id) ON DELETE SET NULL,
  account_manager_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  phone_number text NOT NULL,
  recipient_label text,
  notification_type text NOT NULL DEFAULT 'failed' CHECK (notification_type IN ('success', 'failed', 'duplicate', 'test')),
  send_status text NOT NULL DEFAULT 'pending' CHECK (send_status IN ('pending', 'sent', 'delivered', 'failed')),
  provider_message_id text,
  template_used text,
  rendered_message text,
  error_message text,
  metadata jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roadtour_claim_notification_logs_scan_event
  ON public.roadtour_claim_notification_logs (scan_event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_roadtour_claim_notification_logs_campaign
  ON public.roadtour_claim_notification_logs (campaign_id, created_at DESC);