BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS consumer_claim_confirmed_at timestamptz;

COMMENT ON COLUMN public.users.consumer_claim_confirmed_at IS
  'Timestamp set after an unlinked consumer confirms they want to keep collecting QR points as a consumer lane user.';

COMMIT;