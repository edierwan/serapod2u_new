-- Consumer password-reset OTP: support email channel alongside phone.
-- Aligns auth_verification_codes with Collect Points login (email) and Dynamic Config email providers.

ALTER TABLE public.auth_verification_codes
  ALTER COLUMN phone_normalized DROP NOT NULL;

ALTER TABLE public.auth_verification_codes
  ADD COLUMN IF NOT EXISTS email_normalized text;

ALTER TABLE public.auth_verification_codes
  DROP CONSTRAINT IF EXISTS auth_verification_codes_recipient_check;

ALTER TABLE public.auth_verification_codes
  ADD CONSTRAINT auth_verification_codes_recipient_check
  CHECK (
    (phone_normalized IS NOT NULL AND btrim(phone_normalized) <> '')
    OR (email_normalized IS NOT NULL AND btrim(email_normalized) <> '')
  );

CREATE INDEX IF NOT EXISTS idx_auth_verif_email_purpose
  ON public.auth_verification_codes (email_normalized, purpose, channel);

CREATE INDEX IF NOT EXISTS idx_auth_verif_email_active
  ON public.auth_verification_codes (email_normalized, purpose, channel)
  WHERE invalidated_at IS NULL AND used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notification_events_email
  ON public.notification_events (recipient_email);

-- Dynamic Configuration: password reset OTP is email-only (same pattern as stock count verification).
INSERT INTO public.notification_types (
  category, event_code, event_name, event_description,
  default_enabled, available_channels, is_system, sort_order
)
VALUES (
  'security',
  'password_reset_otp',
  'Password Reset OTP (Consumer)',
  'Sends a one-time code by email when a consumer resets password from Collect Points / loyalty login.',
  true,
  ARRAY['email'],
  true,
  25
)
ON CONFLICT (event_code) DO UPDATE SET
  category = EXCLUDED.category,
  event_name = EXCLUDED.event_name,
  event_description = EXCLUDED.event_description,
  available_channels = EXCLUDED.available_channels,
  is_system = EXCLUDED.is_system,
  sort_order = EXCLUDED.sort_order;
