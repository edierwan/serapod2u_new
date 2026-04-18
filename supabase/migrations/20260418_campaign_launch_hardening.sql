-- Campaign Launch Hardening Migration
-- Fixes: launch_failed state, idempotency, error tracking, recipient consistency
-- Date: 2026-04-18

BEGIN;

-- 1. Add new columns for launch error tracking and idempotency
ALTER TABLE public.marketing_campaigns
  ADD COLUMN IF NOT EXISTS launched_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS launch_error_code text,
  ADD COLUMN IF NOT EXISTS launch_error_message text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS last_transition_at timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS safety_preset_id text;

-- 2. Add unique index on idempotency_key (partial – only non-null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_idempotency_key
  ON public.marketing_campaigns (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 3. Expand status check to include 'launch_failed'
ALTER TABLE public.marketing_campaigns
  DROP CONSTRAINT IF EXISTS marketing_campaigns_status_check;

ALTER TABLE public.marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'draft'::text,
        'scheduled'::text,
        'sending'::text,
        'completed'::text,
        'paused'::text,
        'failed'::text,
        'launch_failed'::text,
        'archived'::text
      ]
    )
  );

-- 4. Index on launch_failed for easy retry queries
CREATE INDEX IF NOT EXISTS idx_campaigns_launch_failed
  ON public.marketing_campaigns (status)
  WHERE status = 'launch_failed';

COMMIT;
