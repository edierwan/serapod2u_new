-- Create Account OTP: email channel (same pattern as password_reset_otp).
-- Requires email_normalized support from 20260728_password_reset_email_otp.sql.

INSERT INTO public.notification_types (
  category, event_code, event_name, event_description,
  default_enabled, available_channels, is_system, sort_order
)
VALUES (
  'security',
  'registration_otp',
  'Registration OTP (Consumer)',
  'Sends a one-time code by email when a consumer creates an account from Collect Points / loyalty signup.',
  true,
  ARRAY['email'],
  true,
  26
)
ON CONFLICT (event_code) DO UPDATE SET
  category = EXCLUDED.category,
  event_name = EXCLUDED.event_name,
  event_description = EXCLUDED.event_description,
  available_channels = EXCLUDED.available_channels,
  is_system = EXCLUDED.is_system,
  sort_order = EXCLUDED.sort_order;
