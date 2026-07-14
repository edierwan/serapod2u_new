-- Migration: Return Product notification event types
-- ---------------------------------------------------------------------------
-- Registers a new "Return Product" notification category (category = 'return')
-- with five configurable events, reusing the existing notification_types /
-- notification_settings / notifications_outbox architecture. No bespoke
-- notification system is introduced.
--
-- Events map 1:1 to the Return Product status flow:
--   return_draft   -> return_submitted -> return_received
--                  -> return_processing -> return_completed
--
-- Idempotent: ON CONFLICT (event_code) keeps event metadata in sync.
-- ---------------------------------------------------------------------------

INSERT INTO public.notification_types (
  category, event_code, event_name, event_description,
  default_enabled, available_channels, is_system, sort_order
)
VALUES
  ('return', 'return_draft_created', 'Return Draft Created',
   'Sent when a product return case is first created and receives its Return No.',
   false, ARRAY['whatsapp','sms','email'], false, 10),
  ('return', 'return_submitted', 'Return Submitted',
   'Sent when a return is submitted from the shop/distributor to the warehouse.',
   false, ARRAY['whatsapp','sms','email'], false, 20),
  ('return', 'return_received', 'Return Received',
   'Sent when the warehouse marks the return as received.',
   false, ARRAY['whatsapp','sms','email'], false, 30),
  ('return', 'return_processing', 'Return Processing',
   'Sent when the return moves into processing at the warehouse.',
   false, ARRAY['whatsapp','sms','email'], false, 40),
  ('return', 'return_completed', 'Return Completed',
   'Sent when the return is completed.',
   false, ARRAY['whatsapp','sms','email'], false, 50)
ON CONFLICT (event_code) DO UPDATE
SET
  category           = EXCLUDED.category,
  event_name         = EXCLUDED.event_name,
  event_description  = EXCLUDED.event_description,
  available_channels = EXCLUDED.available_channels,
  is_system          = EXCLUDED.is_system,
  sort_order         = EXCLUDED.sort_order;
