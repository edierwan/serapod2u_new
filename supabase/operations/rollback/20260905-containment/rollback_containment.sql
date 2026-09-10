-- ============================================================================
-- ROLLBACK — containment migration 20260904100000
-- ----------------------------------------------------------------------------
-- Undoes Phase A containment only. It changes no balance, because containment
-- changed no balance: it only decided which configuration NEW writes land in.
--
-- Running this returns operational write paths to the is_variant_default sink,
-- which means Cellera writes fall into UNCLASSIFIED again and the legacy
-- balance resumes growing. Use it only if containment causes an operational
-- failure that cannot be fixed forward.
--
-- ORDER MATTERS. Run the two files in this order:
--
--   1. prior_functions_<env>.sql   restores the eight pre-containment bodies
--   2. rollback_containment.sql    (this file) drops the new objects
--
-- Restoring the functions first means nothing references the objects this file
-- drops at the moment it drops them.
--
--   ssh -i ~/.ssh/serapod_migration root@<host> \
--     "docker exec -i <container> psql -U postgres -d supabase -v ON_ERROR_STOP=1" \
--     < prior_functions_<env>.sql
--
-- Movements posted into 20NB/STD while containment was live are correct and
-- are NOT reversed by this file. They stay where they landed.
-- ============================================================================

BEGIN;

-- The activation stamp goes last-in, first-out: once it is gone, the preflight
-- reports CANONICAL_RESOLVER_NOT_ACTIVATED and refuses any cutover, which is
-- the correct posture for a rolled-back environment.
DROP TABLE IF EXISTS public.canonical_stock_config_activation;

DROP FUNCTION IF EXISTS public.canonical_stock_config_activated_at();
DROP FUNCTION IF EXISTS public.resolve_operational_stock_config(uuid);
DROP VIEW IF EXISTS public.v_canonical_stock_config;

-- Restore the original comment on the legacy sink resolver.
COMMENT ON FUNCTION public.resolve_default_stock_config(uuid) IS
  'Resolves the variant catch-all stock configuration (is_variant_default).';

COMMIT;

-- Verification after rollback: these must all come back empty / false.
SELECT to_regclass('public.canonical_stock_config_activation')  AS activation_table,
       to_regclass('public.v_canonical_stock_config')           AS canonical_view,
       to_regprocedure('public.resolve_operational_stock_config(uuid)') AS resolver;

SELECT count(*) AS functions_still_referencing_new_resolver
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL (SELECT pg_get_functiondef(p.oid) AS def) d
WHERE n.nspname = 'public' AND p.prokind = 'f'
  AND d.def ~ 'resolve_operational_stock_config';
