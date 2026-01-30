-- Add templates column to notification_settings
-- This migration adds a jsonb column to store message templates for different channels
-- and a column to store custom recipient configuration

ALTER TABLE public.notification_settings 
ADD COLUMN IF NOT EXISTS templates jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS recipient_config jsonb DEFAULT '{}'::jsonb;

-- Update the comments
COMMENT ON COLUMN public.notification_settings.templates IS 'JSONB storing templates per channel e.g. {"whatsapp": "Msg...", "sms": "..."}';
COMMENT ON COLUMN public.notification_settings.recipient_config IS 'JSONB storing dynamic recipient rules e.g. {"type": "dynamic", "target": "manufacturer"}';

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';
