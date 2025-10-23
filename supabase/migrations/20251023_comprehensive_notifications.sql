-- =====================================================
-- COMPREHENSIVE NOTIFICATION SYSTEM
-- =====================================================
-- Created: 2025-10-23
-- Description: Complete notification infrastructure with multi-channel support
-- Channels: WhatsApp, SMS, Email
-- Features: Provider configs, notification types, queue, logs, testing

-- =====================================================
-- 1. NOTIFICATION TYPES TABLE
-- =====================================================
-- Defines what events can trigger notifications
CREATE TABLE IF NOT EXISTS public.notification_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL, -- 'order', 'document', 'inventory', 'qr', 'user'
  event_code TEXT NOT NULL UNIQUE, -- e.g., 'order_submitted', 'order_approved', 'order_closed'
  event_name TEXT NOT NULL, -- Human-readable name
  event_description TEXT,
  default_enabled BOOLEAN DEFAULT false,
  available_channels TEXT[] DEFAULT ARRAY['whatsapp', 'sms', 'email'], -- Which channels support this
  default_template_code TEXT, -- Reference to message_templates
  is_system BOOLEAN DEFAULT false, -- System events that can't be disabled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.notification_types IS 'Catalog of all notification event types with their default settings';
COMMENT ON COLUMN public.notification_types.category IS 'Grouping: order, document, inventory, qr, user';
COMMENT ON COLUMN public.notification_types.event_code IS 'Unique identifier for the event (used in code)';
COMMENT ON COLUMN public.notification_types.is_system IS 'Critical system events that cannot be disabled';

-- =====================================================
-- 2. NOTIFICATION PROVIDER CONFIGS TABLE
-- =====================================================
-- Stores encrypted API credentials for each provider
CREATE TABLE IF NOT EXISTS public.notification_provider_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email')),
  provider_name TEXT NOT NULL, -- 'twilio', 'whatsapp_business', 'aws_sns', 'sendgrid', 'aws_ses', 'resend'
  is_active BOOLEAN DEFAULT false,
  is_sandbox BOOLEAN DEFAULT true, -- Use sandbox/test mode
  
  -- Encrypted configuration (store as JSON)
  config_encrypted TEXT, -- Will store encrypted JSON with API keys, tokens, etc.
  config_iv TEXT, -- Initialization vector for encryption
  
  -- Non-sensitive configuration
  config_public JSONB DEFAULT '{}', -- Non-sensitive settings (from numbers, sender IDs, etc.)
  
  -- Status tracking
  last_test_at TIMESTAMPTZ,
  last_test_status TEXT, -- 'success', 'failed'
  last_test_error TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id),
  
  UNIQUE(org_id, channel, provider_name)
);

COMMENT ON TABLE public.notification_provider_configs IS 'Provider API configurations with encrypted credentials';
COMMENT ON COLUMN public.notification_provider_configs.config_encrypted IS 'Encrypted JSON containing API keys and secrets';
COMMENT ON COLUMN public.notification_provider_configs.config_public IS 'Non-sensitive config like phone numbers, sender IDs, display names';
COMMENT ON COLUMN public.notification_provider_configs.is_sandbox IS 'Use provider test/sandbox mode instead of production';

-- =====================================================
-- 3. NOTIFICATION SETTINGS TABLE (Per Org)
-- =====================================================
-- Replace/extend org_notification_settings
CREATE TABLE IF NOT EXISTS public.notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_code TEXT NOT NULL REFERENCES public.notification_types(event_code) ON DELETE CASCADE,
  
  -- Channel enablement
  enabled BOOLEAN DEFAULT false,
  channels_enabled TEXT[] DEFAULT '{}', -- Which channels to use for this event
  
  -- Recipient configuration
  recipient_roles TEXT[], -- Which roles should receive this notification
  recipient_users UUID[], -- Specific users (optional)
  recipient_custom TEXT[], -- Custom phone/email (for external recipients)
  
  -- Template override
  template_code TEXT, -- Override default template for this org
  
  -- Advanced settings
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  retry_enabled BOOLEAN DEFAULT true,
  max_retries INTEGER DEFAULT 3,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(org_id, event_code)
);

COMMENT ON TABLE public.notification_settings IS 'Per-organization settings for each notification type';
COMMENT ON COLUMN public.notification_settings.channels_enabled IS 'Array of channels to use: whatsapp, sms, email';
COMMENT ON COLUMN public.notification_settings.recipient_roles IS 'Which user roles should receive this notification';

-- =====================================================
-- 4. ENHANCE notifications_outbox TABLE
-- =====================================================
-- Add columns to existing table
DO $$ 
BEGIN
  -- Add event_code if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'notifications_outbox' AND column_name = 'event_code'
  ) THEN
    ALTER TABLE public.notifications_outbox ADD COLUMN event_code TEXT;
  END IF;

  -- Add recipient info
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'notifications_outbox' AND column_name = 'to_email'
  ) THEN
    ALTER TABLE public.notifications_outbox ADD COLUMN to_email TEXT;
  END IF;

  -- Add priority
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'notifications_outbox' AND column_name = 'priority'
  ) THEN
    ALTER TABLE public.notifications_outbox 
    ADD COLUMN priority TEXT DEFAULT 'normal' 
    CHECK (priority IN ('low', 'normal', 'high', 'critical'));
  END IF;

  -- Add retry tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'notifications_outbox' AND column_name = 'retry_count'
  ) THEN
    ALTER TABLE public.notifications_outbox ADD COLUMN retry_count INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'notifications_outbox' AND column_name = 'max_retries'
  ) THEN
    ALTER TABLE public.notifications_outbox ADD COLUMN max_retries INTEGER DEFAULT 3;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'notifications_outbox' AND column_name = 'next_retry_at'
  ) THEN
    ALTER TABLE public.notifications_outbox ADD COLUMN next_retry_at TIMESTAMPTZ;
  END IF;

  -- Add provider tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'notifications_outbox' AND column_name = 'provider_name'
  ) THEN
    ALTER TABLE public.notifications_outbox ADD COLUMN provider_name TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'notifications_outbox' AND column_name = 'provider_message_id'
  ) THEN
    ALTER TABLE public.notifications_outbox ADD COLUMN provider_message_id TEXT;
  END IF;

  -- Add scheduled sending
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'notifications_outbox' AND column_name = 'scheduled_for'
  ) THEN
    ALTER TABLE public.notifications_outbox ADD COLUMN scheduled_for TIMESTAMPTZ;
  END IF;
END $$;

-- Update status constraint to include new statuses
ALTER TABLE public.notifications_outbox DROP CONSTRAINT IF EXISTS notifications_outbox_status_check;
ALTER TABLE public.notifications_outbox ADD CONSTRAINT notifications_outbox_status_check 
  CHECK (status IN ('queued', 'processing', 'sent', 'failed', 'cancelled', 'scheduled'));

COMMENT ON COLUMN public.notifications_outbox.event_code IS 'Links to notification_types.event_code';
COMMENT ON COLUMN public.notifications_outbox.provider_message_id IS 'External provider message ID for tracking';

-- =====================================================
-- 5. NOTIFICATION LOGS TABLE
-- =====================================================
-- Detailed delivery logs for analytics and debugging
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id UUID REFERENCES public.notifications_outbox(id) ON DELETE SET NULL,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  
  -- Event details
  event_code TEXT,
  channel TEXT NOT NULL,
  provider_name TEXT,
  
  -- Recipient
  recipient_type TEXT, -- 'phone', 'email', 'user_id'
  recipient_value TEXT, -- Actual phone/email/user_id
  
  -- Delivery info
  status TEXT NOT NULL, -- 'queued', 'sent', 'delivered', 'failed', 'bounced', 'clicked', 'opened'
  status_details TEXT,
  provider_message_id TEXT,
  provider_response JSONB,
  
  -- Timing
  queued_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  
  -- Error tracking
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  
  -- Cost tracking (optional)
  cost_amount NUMERIC(10, 4),
  cost_currency TEXT DEFAULT 'MYR',
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.notification_logs IS 'Comprehensive delivery logs for all notifications';
COMMENT ON COLUMN public.notification_logs.status IS 'Detailed delivery status from provider webhooks';

-- =====================================================
-- 6. INDEXES
-- =====================================================
-- notifications_outbox indexes
CREATE INDEX IF NOT EXISTS idx_notif_outbox_status_priority ON public.notifications_outbox(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_notif_outbox_next_retry ON public.notifications_outbox(next_retry_at) WHERE status = 'failed' AND retry_count < max_retries;
CREATE INDEX IF NOT EXISTS idx_notif_outbox_scheduled ON public.notifications_outbox(scheduled_for) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_notif_outbox_event_code ON public.notifications_outbox(event_code);

-- notification_logs indexes
CREATE INDEX IF NOT EXISTS idx_notif_logs_org_created ON public.notification_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_logs_status ON public.notification_logs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_logs_event ON public.notification_logs(event_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_logs_provider_msg ON public.notification_logs(provider_message_id) WHERE provider_message_id IS NOT NULL;

-- notification_settings indexes
CREATE INDEX IF NOT EXISTS idx_notif_settings_org ON public.notification_settings(org_id);
CREATE INDEX IF NOT EXISTS idx_notif_settings_enabled ON public.notification_settings(enabled) WHERE enabled = true;

-- notification_provider_configs indexes
CREATE INDEX IF NOT EXISTS idx_notif_provider_org_channel ON public.notification_provider_configs(org_id, channel, is_active);

-- =====================================================
-- 7. SEED DEFAULT NOTIFICATION TYPES
-- =====================================================
INSERT INTO public.notification_types (category, event_code, event_name, event_description, default_enabled, available_channels, is_system) VALUES
-- Order Status Changes
('order', 'order_submitted', 'Order Submitted', 'Notifies when an order is submitted for approval', false, ARRAY['whatsapp', 'sms', 'email'], false),
('order', 'order_approved', 'Order Approved', 'Notifies when an order is approved', true, ARRAY['whatsapp', 'sms', 'email'], false),
('order', 'order_closed', 'Order Closed', 'Notifies when an order workflow is completed', false, ARRAY['whatsapp', 'sms', 'email'], false),
('order', 'order_rejected', 'Order Rejected', 'Notifies when an order is rejected', true, ARRAY['whatsapp', 'sms', 'email'], false),

-- Document Workflow
('document', 'po_created', 'Purchase Order Created', 'Notifies when a PO is generated', false, ARRAY['whatsapp', 'email'], false),
('document', 'po_acknowledged', 'Purchase Order Acknowledged', 'Notifies when a PO is acknowledged', false, ARRAY['whatsapp', 'email'], false),
('document', 'invoice_created', 'Invoice Created', 'Notifies when an invoice is generated', true, ARRAY['whatsapp', 'email'], false),
('document', 'invoice_acknowledged', 'Invoice Acknowledged', 'Notifies when invoice payment is confirmed', false, ARRAY['whatsapp', 'email'], false),
('document', 'payment_received', 'Payment Received', 'Notifies when payment is acknowledged', true, ARRAY['whatsapp', 'sms', 'email'], false),
('document', 'receipt_issued', 'Receipt Issued', 'Notifies when a receipt is issued', false, ARRAY['email'], false),

-- Inventory Alerts
('inventory', 'low_stock_alert', 'Low Stock Alert', 'Notifies when inventory reaches reorder point', false, ARRAY['whatsapp', 'sms', 'email'], false),
('inventory', 'out_of_stock', 'Out of Stock', 'Critical alert when item is out of stock', false, ARRAY['whatsapp', 'sms', 'email'], false),
('inventory', 'stock_received', 'Stock Received', 'Notifies when new stock is received', false, ARRAY['whatsapp', 'email'], false),

-- QR Code & Consumer Activities
('qr', 'qr_activated', 'QR Code Activated', 'Notifies when a consumer scans a QR code', false, ARRAY['whatsapp', 'sms', 'email'], false),
('qr', 'points_awarded', 'Points Awarded', 'Notifies when points are awarded to consumer', false, ARRAY['whatsapp', 'sms'], false),
('qr', 'lucky_draw_entry', 'Lucky Draw Entry', 'Notifies when consumer enters lucky draw', false, ARRAY['whatsapp', 'sms'], false),
('qr', 'redemption_completed', 'Redemption Completed', 'Notifies when points are redeemed', false, ARRAY['whatsapp', 'sms'], false),

-- User Account Activities
('user', 'user_created', 'User Account Created', 'Notifies new user of account creation', true, ARRAY['email'], true),
('user', 'user_activated', 'User Account Activated', 'Notifies when user account is activated', false, ARRAY['email'], false),
('user', 'user_deactivated', 'User Account Deactivated', 'Notifies when user account is deactivated', false, ARRAY['email'], false),
('user', 'password_reset_request', 'Password Reset Requested', 'Sends password reset link', true, ARRAY['email', 'sms'], true),
('user', 'password_changed', 'Password Changed', 'Confirms password change', true, ARRAY['email', 'sms'], true),
('user', 'login_suspicious', 'Suspicious Login Detected', 'Security alert for unusual login', false, ARRAY['email', 'sms'], true)

ON CONFLICT (event_code) DO UPDATE SET
  event_name = EXCLUDED.event_name,
  event_description = EXCLUDED.event_description,
  available_channels = EXCLUDED.available_channels,
  updated_at = NOW();

-- =====================================================
-- 8. ROW LEVEL SECURITY (RLS)
-- =====================================================
ALTER TABLE public.notification_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- Notification types: Read-only for all authenticated users
CREATE POLICY "notification_types_select" ON public.notification_types
  FOR SELECT TO authenticated
  USING (true);

-- Provider configs: Only HQ Power Users and above
CREATE POLICY "provider_configs_hq_power_user" ON public.notification_provider_configs
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON r.role_code = u.role_code
      JOIN public.organizations o ON o.id = u.organization_id
      WHERE u.id = auth.uid()
        AND r.role_level <= 20
        AND o.org_type_code = 'HQ'
        AND o.id = notification_provider_configs.org_id
    )
  );

-- Notification settings: HQ Power Users and above
CREATE POLICY "notification_settings_hq_power_user" ON public.notification_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON r.role_code = u.role_code
      JOIN public.organizations o ON o.id = u.organization_id
      WHERE u.id = auth.uid()
        AND r.role_level <= 20
        AND o.org_type_code = 'HQ'
        AND o.id = notification_settings.org_id
    )
  );

-- Notification logs: Can view own org logs
CREATE POLICY "notification_logs_org_view" ON public.notification_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.organization_id = notification_logs.org_id
    )
  );

-- =====================================================
-- 9. UPDATE TRIGGERS
-- =====================================================
CREATE TRIGGER update_notification_types_updated_at
  BEFORE UPDATE ON public.notification_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_provider_configs_updated_at
  BEFORE UPDATE ON public.notification_provider_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_notification_settings_updated_at
  BEFORE UPDATE ON public.notification_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- =====================================================
-- COMPLETION MESSAGE
-- =====================================================
DO $$ 
BEGIN
  RAISE NOTICE '✅ Comprehensive notification system schema created successfully!';
  RAISE NOTICE '📊 Tables created: notification_types, notification_provider_configs, notification_settings, notification_logs';
  RAISE NOTICE '🔐 RLS policies enabled for security';
  RAISE NOTICE '📝 Default notification types seeded';
  RAISE NOTICE '⏭️  Next: Create database functions for notification processing';
END $$;
