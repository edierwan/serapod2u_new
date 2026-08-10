-- Route organization master-data deletion verification through Notification Types.

INSERT INTO public.notification_types (
  category, event_code, event_name, event_description,
  default_enabled, available_channels, is_system, sort_order
)
VALUES (
  'Delete Organization Masterdata',
  'delete_organization_verification_code',
  'Delete Organization Verification Code',
  'Controls delivery of the security code required before organization master data can be deleted.',
  true,
  ARRAY['whatsapp', 'sms', 'email'],
  true,
  10
)
ON CONFLICT (event_code) DO UPDATE SET
  category = EXCLUDED.category,
  event_name = EXCLUDED.event_name,
  event_description = EXCLUDED.event_description,
  default_enabled = EXCLUDED.default_enabled,
  available_channels = EXCLUDED.available_channels,
  is_system = EXCLUDED.is_system,
  sort_order = EXCLUDED.sort_order;

-- Existing organizations receive an enabled setting using the product's
-- recommended global route. Saving Notification Types later persists the
-- administrator's effective global/category/event selection on this row.
INSERT INTO public.notification_settings (
  org_id, event_code, enabled, channels_enabled, priority,
  recipient_config, templates, retry_enabled, max_retries
)
SELECT
  o.id,
  'delete_organization_verification_code',
  true,
  ARRAY['whatsapp'],
  'critical',
  jsonb_build_object(
    'include_consumer', false,
    'routing', jsonb_build_object(
      'preset', 'whatsapp_email_fallback',
      'source', 'default',
      'default_preset', 'whatsapp_email_fallback'
    )
  ),
  '{}'::jsonb,
  true,
  3
FROM public.organizations o
ON CONFLICT (org_id, event_code) DO NOTHING;
