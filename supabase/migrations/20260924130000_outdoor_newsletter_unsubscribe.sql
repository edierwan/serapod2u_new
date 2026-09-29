BEGIN;

ALTER TABLE public.outdoor_newsletter_subscribers
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz,
  ADD COLUMN IF NOT EXISTS unsubscribe_token text,
  ADD COLUMN IF NOT EXISTS welcomed_at timestamptz;

UPDATE public.outdoor_newsletter_subscribers
SET unsubscribe_token = gen_random_uuid()::text
WHERE unsubscribe_token IS NULL OR unsubscribe_token = '';

CREATE UNIQUE INDEX IF NOT EXISTS outdoor_newsletter_unsubscribe_token_idx
  ON public.outdoor_newsletter_subscribers (unsubscribe_token);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outdoor_newsletter_status_check'
  ) THEN
    ALTER TABLE public.outdoor_newsletter_subscribers
      ADD CONSTRAINT outdoor_newsletter_status_check
      CHECK (status IN ('active', 'unsubscribed'));
  END IF;
END $$;

COMMIT;
