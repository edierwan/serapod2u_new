-- Migration: Return Product report email — audit event type
-- ---------------------------------------------------------------------------
-- Registers the 'return_report_email' event so report-email deliveries logged
-- in notifications_outbox appear under the existing notification audit UI.
-- This event is NOT a status-transition notification: report emails are sent
-- directly (with the PDF attachment) by /api/returns/reporting/email and the
-- outbox row is the delivery record, so default_enabled stays false and the
-- outbox worker never re-sends it (rows are inserted as sent/failed).
--
-- Idempotent: ON CONFLICT (event_code) keeps metadata in sync.
-- ---------------------------------------------------------------------------

INSERT INTO public.notification_types (
  category, event_code, event_name, event_description,
  default_enabled, available_channels, is_system, sort_order
)
VALUES
  ('return', 'return_report_email', 'Return Report Email',
   'Audit record of a Return Product management report emailed with its PDF attachment.',
   false, ARRAY['email'], false, 60)
ON CONFLICT (event_code) DO UPDATE
SET
  category           = EXCLUDED.category,
  event_name         = EXCLUDED.event_name,
  event_description  = EXCLUDED.event_description,
  available_channels = EXCLUDED.available_channels,
  is_system          = EXCLUDED.is_system,
  sort_order         = EXCLUDED.sort_order;
