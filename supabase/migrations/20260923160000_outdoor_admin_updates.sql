BEGIN;

CREATE TABLE IF NOT EXISTS public.outdoor_admin_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  created_by uuid,
  emailed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outdoor_admin_updates_kind_chk CHECK (kind IN ('product', 'color', 'event', 'other'))
);

CREATE INDEX IF NOT EXISTS outdoor_admin_updates_created_idx
  ON public.outdoor_admin_updates (created_at DESC);

ALTER TABLE public.outdoor_admin_updates ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.outdoor_admin_updates IS
  'Outdoor admin posts. Each row is emailed to outdoor_newsletter_subscribers.';

COMMIT;
