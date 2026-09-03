-- Distributed execution lease for internal cron workers.
--
-- Problem this solves:
--   node-cron fires every 60s and does not wait for the previous run, so a
--   single container can overlap a worker with itself; multiple containers make
--   it worse. `FOR UPDATE SKIP LOCKED` inside a PostgREST RPC does NOT help,
--   because those row locks are released when that RPC's transaction commits -
--   which happens before the worker performs any external side effect.
--
-- Safe to apply BEFORE the application code that uses it: the table and
-- functions are additive and nothing else references them.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.release_worker_lease(text, text);
--   DROP FUNCTION IF EXISTS public.try_acquire_worker_lease(text, text, integer);
--   DROP TABLE IF EXISTS public.cron_worker_leases;
--   (Dropping these restores the previous behaviour; workers then fail closed
--    with 503 until the application code is also rolled back.)

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cron_worker_leases (
  worker_name TEXT PRIMARY KEY,
  lease_owner TEXT        NOT NULL,
  lease_until TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cron_worker_leases IS
  'Single-row-per-worker execution lease. Prevents overlapping cron worker runs across processes and containers.';

-- Deny-by-default. No policies are defined, so anon/authenticated see nothing.
-- service_role bypasses RLS, which is the only context that should touch this.
ALTER TABLE public.cron_worker_leases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cron_worker_leases FROM PUBLIC;
REVOKE ALL ON TABLE public.cron_worker_leases FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Atomic acquisition
-- ---------------------------------------------------------------------------
-- The INSERT .. ON CONFLICT DO UPDATE .. WHERE takes a row lock on conflict, so
-- exactly one concurrent caller can win. When the existing lease is still live
-- the UPDATE's WHERE is false, no row is returned, and we report NOT ACQUIRED.
CREATE OR REPLACE FUNCTION public.try_acquire_worker_lease(
  p_worker_name TEXT,
  p_owner       TEXT,
  p_ttl_seconds INTEGER DEFAULT 180
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner TEXT;
BEGIN
  IF p_worker_name IS NULL OR btrim(p_worker_name) = '' THEN
    RAISE EXCEPTION 'p_worker_name is required';
  END IF;

  IF p_owner IS NULL OR btrim(p_owner) = '' THEN
    RAISE EXCEPTION 'p_owner is required';
  END IF;

  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 OR p_ttl_seconds > 3600 THEN
    RAISE EXCEPTION 'p_ttl_seconds must be between 1 and 3600';
  END IF;

  INSERT INTO public.cron_worker_leases AS l (worker_name, lease_owner, lease_until, updated_at)
  VALUES (p_worker_name, p_owner, now() + make_interval(secs => p_ttl_seconds), now())
  ON CONFLICT (worker_name) DO UPDATE
    SET lease_owner = EXCLUDED.lease_owner,
        lease_until = EXCLUDED.lease_until,
        updated_at  = now()
    WHERE l.lease_until < now()
  RETURNING l.lease_owner INTO v_owner;

  RETURN v_owner IS NOT NULL AND v_owner = p_owner;
END;
$$;

COMMENT ON FUNCTION public.try_acquire_worker_lease(TEXT, TEXT, INTEGER) IS
  'Atomically acquire a cron worker lease. Returns true only if this owner now holds it.';

-- ---------------------------------------------------------------------------
-- Owner-safe release
-- ---------------------------------------------------------------------------
-- Deletes only when BOTH worker_name and lease_owner match, so a stale run can
-- never release a lease that a newer run has already reclaimed.
CREATE OR REPLACE FUNCTION public.release_worker_lease(
  p_worker_name TEXT,
  p_owner       TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  IF p_worker_name IS NULL OR p_owner IS NULL THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.cron_worker_leases
   WHERE worker_name = p_worker_name
     AND lease_owner = p_owner;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

COMMENT ON FUNCTION public.release_worker_lease(TEXT, TEXT) IS
  'Release a cron worker lease only if the supplied owner still holds it.';

-- ---------------------------------------------------------------------------
-- Grants: service_role only. Never anon/authenticated.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.try_acquire_worker_lease(TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_acquire_worker_lease(TEXT, TEXT, INTEGER) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.release_worker_lease(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_worker_lease(TEXT, TEXT) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.try_acquire_worker_lease(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_worker_lease(TEXT, TEXT) TO service_role;
