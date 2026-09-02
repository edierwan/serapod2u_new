-- User deletion OTP: configurable notification type (Phase 1 catalog only).
-- Delivery remains synchronous in app code until Phase 2 wires routing settings.

INSERT INTO public.notification_types (
  category, event_code, event_name, event_description,
  default_enabled, available_channels, is_system, sort_order
)
VALUES (
  'security',
  'delete_user_otp',
  'User Deletion OTP',
  'Verification code sent to the organization contact phone/email when HQ removes or archives a user. Synchronous security OTP (not outbox). Default route: WhatsApp, then SMS, then Email.',
  true,
  ARRAY['whatsapp', 'sms', 'email'],
  true,
  26
)
ON CONFLICT (event_code) DO UPDATE SET
  category = EXCLUDED.category,
  event_name = EXCLUDED.event_name,
  event_description = EXCLUDED.event_description,
  default_enabled = EXCLUDED.default_enabled,
  available_channels = EXCLUDED.available_channels,
  is_system = EXCLUDED.is_system,
  sort_order = EXCLUDED.sort_order;
