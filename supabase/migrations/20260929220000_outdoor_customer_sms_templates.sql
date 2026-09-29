BEGIN;

CREATE TABLE IF NOT EXISTS public.outdoor_customer_message_settings (
  event_code text PRIMARY KEY,
  email_enabled boolean NOT NULL,
  sms_enabled boolean NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.outdoor_customer_message_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.outdoor_customer_message_settings
  ADD COLUMN IF NOT EXISTS sms_template text;

COMMENT ON COLUMN public.outdoor_customer_message_settings.sms_template IS
  'Staff wording for this event''s SMS, with {{placeholders}}. NULL uses the built-in text.';

COMMIT;
