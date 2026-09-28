-- ============================================================================
-- Identity Foundation Stage 2 — one identity per email and per verified phone
-- ----------------------------------------------------------------------------
-- Requires 20260929170000 (identifier drift sync) to have run.
--
-- Email and phone remain identifiers, never keys (the key is users.id):
--   * users_email_normalized_key  UNIQUE (email_normalized)
--       — the canonical trim+lowercase form; replaces reliance on the
--         case-sensitive users_email_key (which stays, harmless).
--   * users_verified_phone_key    UNIQUE (phone) WHERE phone_verified_at IS NOT NULL
--       — a verified phone proves ownership, so it can belong to one identity
--         only. Unverified phones may still repeat (they never resolve an
--         identity on their own: identity_resolve reports
--         IDENTITY_VERIFICATION_REQUIRED / IDENTITY_AMBIGUOUS_PHONE).
--
-- Pre-check: the migration refuses to run (clean error, nothing changed) if
-- any duplicate exists, and names the count; resolve those identities first.
-- Index builds take a short lock on public.users (≈1.7k rows on staging).
-- Idempotent: yes. No migration mode is changed.
--
-- Rollback:
--   drop index if exists public.users_email_normalized_key;
--   drop index if exists public.users_verified_phone_key;
-- ============================================================================
DO $pre$
DECLARE v_email integer; v_phone integer;
BEGIN
  SELECT count(*) INTO v_email FROM (SELECT email_normalized FROM public.users WHERE email_normalized IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d;
  SELECT count(*) INTO v_phone FROM (SELECT phone FROM public.users WHERE phone IS NOT NULL AND phone_verified_at IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d;
  IF v_email > 0 OR v_phone > 0 THEN
    RAISE EXCEPTION 'identifier uniqueness pre-check failed: % duplicate normalized email group(s), % duplicate verified phone group(s)', v_email, v_phone
      USING HINT = 'Resolve the duplicate identities (identity conflicts) before adding uniqueness.';
  END IF;
END
$pre$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_key ON public.users (email_normalized);
CREATE UNIQUE INDEX IF NOT EXISTS users_verified_phone_key ON public.users (phone) WHERE phone_verified_at IS NOT NULL;
DROP INDEX IF EXISTS public.users_email_normalized_idx;   -- superseded by the unique index

DO $$
BEGIN
  IF to_regclass('public.users_email_normalized_key') IS NULL OR to_regclass('public.users_verified_phone_key') IS NULL THEN
    RAISE EXCEPTION 'postcondition: identifier unique indexes missing';
  END IF;
  IF NOT (SELECT indisunique FROM pg_index WHERE indexrelid = 'public.users_email_normalized_key'::regclass) THEN
    RAISE EXCEPTION 'postcondition: users_email_normalized_key must be unique';
  END IF;
END $$;
