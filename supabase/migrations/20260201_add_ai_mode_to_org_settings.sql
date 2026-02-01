-- Add ai_mode column to org_notification_settings table
-- This stores the global AI auto-reply mode for WhatsApp (auto | takeover)

ALTER TABLE public.org_notification_settings 
ADD COLUMN IF NOT EXISTS ai_mode text DEFAULT 'auto' NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.org_notification_settings.ai_mode IS 'AI auto-reply mode: auto = AI responds automatically, takeover = human agents only';
