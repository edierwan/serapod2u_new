INSERT INTO public.notification_types (
  category,
  event_code,
  event_name,
  event_description,
  default_enabled,
  available_channels,
  is_system,
  sort_order
)
VALUES (
  'user',
  'user_created_shop',
  'User Create New Shop',
  'Sent when a user successfully creates a new shop from the QR profile flow.',
  false,
  ARRAY['whatsapp', 'sms', 'email'],
  false,
  15
)
ON CONFLICT (event_code) DO UPDATE
SET
  category = EXCLUDED.category,
  event_name = EXCLUDED.event_name,
  event_description = EXCLUDED.event_description,
  default_enabled = EXCLUDED.default_enabled,
  available_channels = EXCLUDED.available_channels,
  is_system = EXCLUDED.is_system,
  sort_order = EXCLUDED.sort_order;