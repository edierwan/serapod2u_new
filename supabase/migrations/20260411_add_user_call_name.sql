BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS call_name text;

COMMENT ON COLUMN public.users.call_name IS
  'Optional short/preferred name for future display and messaging use.';

COMMIT;
