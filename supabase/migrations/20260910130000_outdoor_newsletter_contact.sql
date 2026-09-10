BEGIN;

-- Outdoor newsletter + contact inbox (API writes via service role).
CREATE TABLE IF NOT EXISTS public.outdoor_newsletter_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  email_normalized text NOT NULL,
  source text NOT NULL DEFAULT 'outdoor_home',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outdoor_newsletter_email_unique UNIQUE (email_normalized)
);

CREATE TABLE IF NOT EXISTS public.outdoor_contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outdoor_contact_messages_created_idx
  ON public.outdoor_contact_messages (created_at DESC);

ALTER TABLE public.outdoor_newsletter_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outdoor_contact_messages ENABLE ROW LEVEL SECURITY;

-- No public policies: inserts go through Next.js admin client only.

COMMENT ON TABLE public.outdoor_newsletter_subscribers IS
  'Serapod Outdoor newsletter signups';
COMMENT ON TABLE public.outdoor_contact_messages IS
  'Serapod Outdoor contact form submissions';

COMMIT;
