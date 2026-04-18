BEGIN;

ALTER TABLE public.marketing_send_logs
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_response jsonb;

ALTER TABLE public.marketing_report_sessions
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_chat_id text,
  ADD COLUMN IF NOT EXISTS provider_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS last_outbound_message_id text,
  ADD COLUMN IF NOT EXISTS last_outbound_sent_at timestamp with time zone;

UPDATE public.marketing_report_sessions
SET expires_at = COALESCE(expires_at, created_at + interval '24 hours');

ALTER TABLE public.marketing_report_sessions
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '24 hours');

ALTER TABLE public.marketing_reply_logs
  ADD COLUMN IF NOT EXISTS inbound_message_id text,
  ADD COLUMN IF NOT EXISTS outbound_message_id text,
  ADD COLUMN IF NOT EXISTS matched_by text,
  ADD COLUMN IF NOT EXISTS provider_context jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_marketing_send_logs_provider_message_id
  ON public.marketing_send_logs(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_report_sessions_provider_message_id
  ON public.marketing_report_sessions(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_report_sessions_last_outbound_message_id
  ON public.marketing_report_sessions(last_outbound_message_id)
  WHERE last_outbound_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_report_sessions_expires_at
  ON public.marketing_report_sessions(expires_at);

COMMIT;