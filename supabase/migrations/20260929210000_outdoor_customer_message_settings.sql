BEGIN;

CREATE TABLE IF NOT EXISTS public.outdoor_customer_message_settings (
  event_code text PRIMARY KEY,
  email_enabled boolean NOT NULL,
  sms_enabled boolean NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.outdoor_customer_message_settings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.outdoor_customer_message_settings IS
  'Which Outdoor order events email or text the customer. An event with no row uses the built-in default.';

COMMIT;
