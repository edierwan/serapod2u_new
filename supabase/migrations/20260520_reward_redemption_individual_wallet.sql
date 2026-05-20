-- ============================================================
-- Reward Redemption Individual Wallet Model
-- Date: 2026-05-20
--
-- Safety:
-- - Additive schema only
-- - No historical points_transactions wallet-owner rewrite
-- - Existing rewards backfilled to wallet_scope='consumer'
-- - Manual review required before applying in production
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Explicit wallet-owner fields for points_transactions
-- ============================================================
ALTER TABLE public.points_transactions
  ADD COLUMN IF NOT EXISTS wallet_scope text,
  ADD COLUMN IF NOT EXISTS wallet_owner_user_id uuid,
  ADD COLUMN IF NOT EXISTS wallet_owner_org_id uuid,
  ADD COLUMN IF NOT EXISTS reporting_shop_id uuid,
  ADD COLUMN IF NOT EXISTS wallet_balance_after integer,
  ADD COLUMN IF NOT EXISTS wallet_source text;

COMMENT ON COLUMN public.points_transactions.wallet_scope IS
  'Explicit wallet scope for new rows: consumer or shop. Historical rows may remain null until reviewed.';
COMMENT ON COLUMN public.points_transactions.wallet_owner_user_id IS
  'User who owns/spends the wallet for consumer-scoped rows.';
COMMENT ON COLUMN public.points_transactions.wallet_owner_org_id IS
  'Organization that owns/spends the wallet for shop-scoped rows.';
COMMENT ON COLUMN public.points_transactions.reporting_shop_id IS
  'Optional shop/org attribution used for reporting only. Not the wallet owner for consumer rows.';
COMMENT ON COLUMN public.points_transactions.wallet_balance_after IS
  'Balance after the transaction on the resolved wallet owner only.';
COMMENT ON COLUMN public.points_transactions.wallet_source IS
  'Application or process that resolved the wallet owner for the row, e.g. mobile_consumer_reward.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'points_transactions_wallet_scope_check'
      AND conrelid = 'public.points_transactions'::regclass
  ) THEN
    ALTER TABLE public.points_transactions
      ADD CONSTRAINT points_transactions_wallet_scope_check
      CHECK (wallet_scope IS NULL OR wallet_scope IN ('consumer', 'shop'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'points_transactions_wallet_owner_check'
      AND conrelid = 'public.points_transactions'::regclass
  ) THEN
    ALTER TABLE public.points_transactions
      ADD CONSTRAINT points_transactions_wallet_owner_check
      CHECK (
        wallet_scope IS NULL
        OR (
          wallet_scope = 'consumer'
          AND wallet_owner_user_id IS NOT NULL
          AND wallet_owner_org_id IS NULL
        )
        OR (
          wallet_scope = 'shop'
          AND wallet_owner_org_id IS NOT NULL
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_points_transactions_wallet_owner_user_id
  ON public.points_transactions (wallet_owner_user_id);

CREATE INDEX IF NOT EXISTS idx_points_transactions_reporting_shop_id
  ON public.points_transactions (reporting_shop_id);

-- ============================================================
-- 2. Explicit reward wallet scope on redeem_items
-- ============================================================
ALTER TABLE public.redeem_items
  ADD COLUMN IF NOT EXISTS wallet_scope text DEFAULT 'consumer';

UPDATE public.redeem_items
SET wallet_scope = 'consumer'
WHERE wallet_scope IS NULL;

COMMENT ON COLUMN public.redeem_items.wallet_scope IS
  'Reward wallet scope. consumer = individual user wallet, shop = explicit shop wallet flow.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'redeem_items_wallet_scope_check'
      AND conrelid = 'public.redeem_items'::regclass
  ) THEN
    ALTER TABLE public.redeem_items
      ADD CONSTRAINT redeem_items_wallet_scope_check
      CHECK (wallet_scope IN ('consumer', 'shop'));
  END IF;
END $$;

-- ============================================================
-- 3. Isolate new consumer-scoped rows from the legacy shop wallet ledger
-- ============================================================
CREATE OR REPLACE VIEW public.shop_points_ledger AS
SELECT
  cqs.id,
  cqs.shop_id,
  cqs.consumer_id,
  cqs.journey_config_id,
  qc.order_id,
  qc.order_item_id,
  qc.product_id,
  qc.variant_id,
  cqs.points_collected_at AS occurred_at,
  COALESCE(cqs.points_amount, 0) AS points_change,
  CASE
    WHEN cqs.is_manual_adjustment THEN COALESCE(cqs.adjustment_type, 'manual')
    ELSE 'scan'
  END AS transaction_type,
  cqs.is_manual_adjustment,
  cqs.adjusted_by,
  cqs.adjustment_reason,
  NULL::uuid AS redeem_item_id,
  NULL::text AS consumer_phone,
  NULL::text AS consumer_email,
  NULL::text AS description,
  pv.variant_name,
  p.product_name,
  NULL::text AS reward_name,
  NULL::text AS reward_code,
  o.order_no,
  cqs.claim_lane,
  'scan'::text AS point_category,
  CASE
    WHEN cqs.is_manual_adjustment THEN 'manual_add'::text
    ELSE 'product_qr'::text
  END AS point_indicator,
  'consumer'::text AS point_owner_type,
  'earn'::text AS point_direction
FROM public.consumer_qr_scans cqs
LEFT JOIN public.qr_codes qc ON qc.id = cqs.qr_code_id
LEFT JOIN public.product_variants pv ON pv.id = qc.variant_id
LEFT JOIN public.products p ON p.id = pv.product_id
LEFT JOIN public.orders o ON o.id = qc.order_id
WHERE cqs.collected_points = true

UNION ALL

SELECT
  pt.id,
  CASE
    WHEN pt.wallet_scope = 'consumer' THEN NULL::uuid
    WHEN pt.wallet_scope = 'shop' THEN COALESCE(pt.wallet_owner_org_id, pt.company_id)
    ELSE COALESCE(
      pt.company_id,
      (
        SELECT u.organization_id
        FROM public.users u
        JOIN public.organizations org ON org.id = u.organization_id
        WHERE (u.phone = pt.consumer_phone OR u.email = pt.consumer_email)
          AND org.org_type_code = ANY (ARRAY['SHOP', 'INDEP'])
        LIMIT 1
      )
    )
  END AS shop_id,
  COALESCE(pt.wallet_owner_user_id, pt.user_id) AS consumer_id,
  NULL::uuid AS journey_config_id,
  NULL::uuid AS order_id,
  NULL::uuid AS order_item_id,
  NULL::uuid AS product_id,
  NULL::uuid AS variant_id,
  pt.transaction_date AS occurred_at,
  pt.points_amount AS points_change,
  pt.transaction_type,
  CASE
    WHEN pt.transaction_type = 'adjust' THEN true
    ELSE false
  END AS is_manual_adjustment,
  NULL::uuid AS adjusted_by,
  NULL::text AS adjustment_reason,
  pt.redeem_item_id,
  pt.consumer_phone,
  pt.consumer_email,
  pt.description,
  NULL::text AS variant_name,
  NULL::text AS product_name,
  ri.item_name AS reward_name,
  ri.item_code AS reward_code,
  NULL::text AS order_no,
  NULL::text AS claim_lane,
  pt.point_category,
  pt.point_indicator,
  pt.point_owner_type,
  pt.point_direction
FROM public.points_transactions pt
LEFT JOIN public.redeem_items ri ON ri.id = pt.redeem_item_id
WHERE pt.consumer_phone IS NOT NULL
   OR pt.consumer_email IS NOT NULL
   OR pt.company_id IS NOT NULL
   OR pt.wallet_owner_user_id IS NOT NULL
   OR pt.wallet_owner_org_id IS NOT NULL
   OR pt.reporting_shop_id IS NOT NULL;

COMMENT ON VIEW public.shop_points_ledger IS
  'Unified ledger for legacy shop wallet rows and consumer history. New wallet_scope=consumer rows keep shop_id null so they do not enter shop wallet balances.';

CREATE OR REPLACE VIEW public.v_shop_points_balance AS
SELECT
  shop_id,
  SUM(points_change) AS current_balance,
  COUNT(*) AS transaction_count,
  MIN(occurred_at) AS first_transaction_at,
  MAX(occurred_at) AS last_transaction_at,
  SUM(CASE WHEN transaction_type = 'scan' THEN points_change ELSE 0 END) AS total_earned_scans,
  SUM(CASE WHEN transaction_type = ANY(ARRAY['manual', 'adjust']) THEN points_change ELSE 0 END) AS total_manual_adjustments,
  SUM(CASE WHEN transaction_type = 'redeem' THEN ABS(points_change) ELSE 0 END) AS total_redeemed,
  COUNT(CASE WHEN transaction_type = 'scan' THEN 1 ELSE NULL END) AS scan_count,
  COUNT(CASE WHEN transaction_type = 'redeem' THEN 1 ELSE NULL END) AS redemption_count
FROM public.shop_points_ledger
WHERE shop_id IS NOT NULL
GROUP BY shop_id;

COMMENT ON VIEW public.v_shop_points_balance IS
  'Aggregated legacy or explicit shop-wallet balances. Excludes new wallet_scope=consumer rows.';

-- ============================================================
-- 4. Reporting-only shop view built from attached users' wallets
-- ============================================================
DROP VIEW IF EXISTS public.v_shop_user_points_reporting;

CREATE VIEW public.v_shop_user_points_reporting AS
WITH attached_users AS (
  SELECT
    u.organization_id AS shop_id,
    u.id AS user_id
  FROM public.users u
  JOIN public.organizations o ON o.id = u.organization_id
  WHERE o.org_type_code = 'SHOP'
    AND u.role_code IN ('GUEST', 'CONSUMER', 'USER')
    AND COALESCE(u.is_active, true) = true
),
consumer_balances AS (
  SELECT
    user_id,
    current_balance,
    total_collected_system,
    total_collected_manual,
    total_migration,
    total_redeemed,
    transaction_count,
    last_transaction_date
  FROM public.v_consumer_points_balance
),
consumer_bonus_points AS (
  SELECT
    pt.user_id,
    COALESCE(SUM(pt.points_amount), 0)::bigint AS total_bonus_points
  FROM public.points_transactions pt
  WHERE pt.user_id IS NOT NULL
    AND (pt.transaction_type = 'earn' OR pt.point_category = 'bonus')
  GROUP BY pt.user_id
),
anonymous_shop_scans AS (
  SELECT
    cqs.shop_id,
    COUNT(*)::bigint AS anonymous_shop_scan_count,
    COALESCE(SUM(cqs.points_amount), 0)::bigint AS anonymous_shop_scan_points
  FROM public.consumer_qr_scans cqs
  WHERE cqs.collected_points = true
    AND cqs.shop_id IS NOT NULL
    AND cqs.consumer_id IS NULL
  GROUP BY cqs.shop_id
)
SELECT
  o.id AS shop_id,
  o.org_name AS shop_name,
  o.branch AS branch_name,
  o.contact_name,
  o.contact_phone,
  COALESCE(s.state_name, '') AS state,
  COUNT(au.user_id)::bigint AS total_attached_users,
  COALESCE(SUM(cb.current_balance), 0)::bigint AS shop_current_user_balance,
  COALESCE(SUM(cb.total_collected_system), 0)::bigint AS total_collected_system,
  COALESCE(SUM(cb.total_collected_manual), 0)::bigint AS total_collected_manual,
  COALESCE(SUM(cb.total_migration), 0)::bigint AS total_migration_points,
  COALESCE(SUM(cb.total_redeemed), 0)::bigint AS total_redeemed_by_attached_users,
  COALESCE(SUM(COALESCE(bp.total_bonus_points, 0)), 0)::bigint AS total_bonus_points,
  COALESCE(
    SUM(
      COALESCE(cb.total_collected_system, 0)
      + COALESCE(cb.total_collected_manual, 0)
      + COALESCE(cb.total_migration, 0)
      + COALESCE(bp.total_bonus_points, 0)
    ),
    0
  )::bigint AS total_earned_by_attached_users,
  COALESCE(SUM(cb.transaction_count), 0)::bigint AS total_transactions,
  MAX(cb.last_transaction_date) AS last_activity,
  COALESCE(anon.anonymous_shop_scan_points, 0)::bigint AS anonymous_shop_scan_points,
  COALESCE(anon.anonymous_shop_scan_count, 0)::bigint AS anonymous_shop_scan_count
FROM public.organizations o
LEFT JOIN public.states s ON s.id = o.state_id
LEFT JOIN attached_users au ON au.shop_id = o.id
LEFT JOIN consumer_balances cb ON cb.user_id = au.user_id
LEFT JOIN consumer_bonus_points bp ON bp.user_id = au.user_id
LEFT JOIN anonymous_shop_scans anon ON anon.shop_id = o.id
WHERE o.org_type_code = 'SHOP'
GROUP BY
  o.id,
  o.org_name,
  o.branch,
  o.contact_name,
  o.contact_phone,
  s.state_name,
  anon.anonymous_shop_scan_points,
  anon.anonymous_shop_scan_count;

COMMENT ON VIEW public.v_shop_user_points_reporting IS
  'Reporting-only shop summary built from attached users'' individual wallets plus separate anonymous shop scan metrics.';

GRANT SELECT ON public.v_shop_user_points_reporting TO authenticated;
REVOKE ALL ON public.v_shop_user_points_reporting FROM anon;

COMMIT;