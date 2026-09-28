-- ============================================================================
-- Customer / Loyalty hotfix — server-authoritative consumer reward ledger
-- ----------------------------------------------------------------------------
-- Incident (production, 2026-09-28)
--   Rewards -> Collect Daily Point  and  Rewards -> RM100 CASH -> Confirm both
--   fail with "new row violates row-level security policy for table
--   points_transactions".
--
--   /api/consumer/redeem-reward inserted the ledger row through the consumer's
--   own session (PostgREST as `authenticated`) with company_id = NULL.
--   Since Phase 0B (20260927110000 / 20260927130000):
--     * bonus credit (transaction_type 'earn', points > 0): the only INSERT
--       policy a non-staff consumer could match is sa_member_redemption_debit_
--       insert, which only admits debits -> denied (correctly: consumers must
--       never mint points through the API).
--     * redemption debit: sa_member_redemption_debit_insert requires
--       get_company_id(company_id) = sa_actor_company_id(); NULL company_id
--       (and, for independent consumers, a NULL actor company) makes that
--       NULL -> denied.
--   sa_points_api_write_guard is not involved (customer.* modes are SHADOW,
--   and redemption debits return early).
--
-- Purpose
--   1. public.consumer_reward_claim(p_user_id, p_reward_id, p_request_key):
--      one atomic, server-only ledger operation for mobile consumer rewards
--      (bonus-point collection and reward redemption). It re-resolves every
--      business fact on the server (user, shop affiliation, reward, wallet,
--      amount, balance, eligibility, stock) and never takes an amount, a
--      wallet owner, a balance or an organization from the caller.
--      Balance comes from public.consumer_reward_wallet_balance(), the
--      production v_consumer_points_balance formula keyed by user id.
--   2. public.consumer_reward_requests: idempotency record so a retried or
--      double-clicked request (same request key) returns the original result
--      instead of writing a second ledger row.
--   3. Drops sa_member_redemption_debit_insert. Its callers were the mobile
--      route (now uses 1.) and ShopCatalogPage shop-wallet redemption, which
--      is disabled in code (SHOP_WALLET_REDEMPTION_ENABLED = false; no non-
--      mobile redemption row in production since 2026-05). While present it
--      let any shop-linked consumer insert a "redeem" row of any size (e.g.
--      -1 point for an iPhone, or against another consumer's user_id).
--
-- Security rationale
--   * EXECUTE is granted to service_role only. Browsers / PostgREST sessions
--     (anon, authenticated) cannot call the function, and points_transactions
--     RLS is not widened: after this migration a non-staff authenticated user
--     has no INSERT policy on points_transactions at all.
--   * The caller (the Next.js route) passes the user id taken from the
--     verified Supabase session; the function trusts nothing else.
--   * Concurrency: a transaction-scoped advisory lock per consumer wallet (and
--     per phone number, which legacy daily limits key on) serialises every
--     claim, so check -> calculate -> insert cannot interleave; the reward row
--     is locked FOR UPDATE for the stock decrement.
--
-- Idempotency
--   CREATE ... IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS;
--   safe to run more than once. No session state is carried between
--   statements (no temp tables, no SET).
--
-- Rollback guidance
--   DROP FUNCTION IF EXISTS public.consumer_reward_claim(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.consumer_reward_wallet_balance(uuid);
--   DROP TABLE IF EXISTS public.consumer_reward_requests;
--   and, only together with reverting the application to the session-client
--   insert, recreate sa_member_redemption_debit_insert from
--   20260927130000_phase0b_points_company_scope_fix.sql.
--   Ledger rows written by the function are ordinary points_transactions rows
--   and stay valid after a rollback.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Idempotency record (server only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consumer_reward_requests (
  user_id        uuid        NOT NULL,
  request_key    text        NOT NULL CHECK (char_length(request_key) BETWEEN 8 AND 128),
  redeem_item_id uuid        NOT NULL,
  transaction_id uuid        NOT NULL REFERENCES public.points_transactions(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_key)
);
CREATE INDEX IF NOT EXISTS idx_consumer_reward_requests_transaction
  ON public.consumer_reward_requests (transaction_id);

COMMENT ON TABLE public.consumer_reward_requests IS
  'Idempotency keys for public.consumer_reward_claim (mobile reward collection/redemption). Server only.';

ALTER TABLE public.consumer_reward_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.consumer_reward_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.consumer_reward_requests TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Consumer wallet balance
--    The production v_consumer_points_balance.current_balance formula, keyed
--    by user id. The view itself is not used because its row filter differs
--    between environments (staging's 20260411 shop-lane cleanup hides
--    shop-linked consumers from it), which would read their balance as 0.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consumer_reward_wallet_balance(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(sp.earned, 0)
       + CASE WHEN COALESCE(sp.manual, 0) > 0 THEN sp.manual ELSE COALESCE(tp.adjusted, 0) END
       + COALESCE(tp.other, 0)
    FROM (SELECT sum(CASE WHEN COALESCE(s.is_manual_adjustment, false) THEN 0 ELSE s.points_amount END)::bigint AS earned,
                 sum(CASE WHEN COALESCE(s.is_manual_adjustment, false) THEN s.points_amount ELSE 0 END)::bigint AS manual
            FROM public.consumer_qr_scans s
           WHERE s.consumer_id = p_user_id AND s.collected_points = true) sp,
         (SELECT sum(CASE WHEN t.transaction_type = 'adjust' THEN 0 ELSE t.points_amount END)::bigint AS other,
                 sum(CASE WHEN t.transaction_type = 'adjust' THEN t.points_amount ELSE 0 END)::bigint AS adjusted
            FROM public.points_transactions t
           WHERE t.user_id = p_user_id) tp
$$;

REVOKE ALL ON FUNCTION public.consumer_reward_wallet_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consumer_reward_wallet_balance(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Atomic reward ledger operation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consumer_reward_claim(
  p_user_id     uuid,
  p_reward_id   uuid,
  p_request_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user            record;
  v_org_type        text;
  v_reporting_shop  uuid;
  v_reward          public.redeem_items%ROWTYPE;
  v_is_bonus        boolean;
  v_mode            text;
  v_phone           text;
  v_required        integer := 0;
  v_change          integer;
  v_balance         bigint;
  v_new_balance     bigint;
  v_txn_id          uuid := gen_random_uuid();
  v_code            text;
  v_day_start       timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_prior           integer;
  v_replay          record;
BEGIN
  IF p_user_id IS NULL OR p_reward_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 400, 'code', 'INVALID_REQUEST',
                              'error', 'Reward ID is required');
  END IF;
  IF p_request_key IS NOT NULL AND char_length(p_request_key) NOT BETWEEN 8 AND 128 THEN
    RETURN jsonb_build_object('success', false, 'status', 400, 'code', 'INVALID_REQUEST',
                              'error', 'Invalid request key');
  END IF;

  -- Serialise every reward claim for this consumer wallet.
  PERFORM pg_advisory_xact_lock(hashtextextended('consumer_reward_wallet:' || p_user_id::text, 0));

  -- Replay of an already-completed request: return the original result.
  IF p_request_key IS NOT NULL THEN
    SELECT r.redeem_item_id, pt.id, pt.points_amount, pt.balance_after, pt.redemption_code,
           pt.transaction_type, pt.reporting_shop_id
      INTO v_replay
      FROM public.consumer_reward_requests r
      JOIN public.points_transactions pt ON pt.id = r.transaction_id
     WHERE r.user_id = p_user_id AND r.request_key = p_request_key;
    IF FOUND THEN
      IF v_replay.redeem_item_id IS DISTINCT FROM p_reward_id THEN
        RETURN jsonb_build_object('success', false, 'status', 409, 'code', 'REQUEST_KEY_REUSED',
                                  'error', 'This request was already used for a different reward.');
      END IF;
      RETURN jsonb_build_object(
        'success', true, 'status', 200, 'replayed', true,
        'transaction_id', v_replay.id,
        'is_bonus_points', v_replay.transaction_type = 'earn',
        'points_change', v_replay.points_amount,
        'required_points', GREATEST(-v_replay.points_amount, 0),
        'new_balance', v_replay.balance_after,
        'redemption_code', v_replay.redemption_code,
        'wallet_scope', 'consumer',
        'wallet_owner_user_id', p_user_id,
        'wallet_owner_org_id', NULL,
        'reporting_shop_id', v_replay.reporting_shop_id);
    END IF;
  END IF;

  -- Consumer identity and affiliation (server truth only).
  SELECT u.id, u.phone, u.email, u.organization_id, u.is_active
    INTO v_user
    FROM public.users u
   WHERE u.id = p_user_id;
  IF NOT FOUND OR v_user.is_active IS FALSE THEN
    RETURN jsonb_build_object('success', false, 'status', 404, 'code', 'USER_NOT_FOUND',
                              'error', 'User profile not found');
  END IF;

  IF v_user.organization_id IS NOT NULL THEN
    SELECT o.org_type_code INTO v_org_type FROM public.organizations o WHERE o.id = v_user.organization_id;
    IF v_org_type IS DISTINCT FROM 'SHOP' THEN
      RETURN jsonb_build_object('success', false, 'status', 403, 'code', 'ORG_NOT_ALLOWED',
                                'error', 'Only shop users or independent consumers can redeem rewards');
    END IF;
    v_reporting_shop := v_user.organization_id;
  END IF;

  v_phone := COALESCE(v_user.phone, '');
  IF v_phone <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('consumer_reward_phone:' || v_phone, 0));
  END IF;

  -- Reward definition (locked for the stock decrement).
  SELECT * INTO v_reward
    FROM public.redeem_items ri
   WHERE ri.id = p_reward_id AND ri.is_active IS TRUE
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 404, 'code', 'REWARD_NOT_FOUND',
                              'error', 'Reward not found or no longer available');
  END IF;
  IF COALESCE(v_reward.wallet_scope, 'consumer') <> 'consumer' THEN
    RETURN jsonb_build_object('success', false, 'status', 403, 'code', 'SHOP_WALLET_DISABLED',
                              'error', 'Shop wallet rewards are disabled for mobile redemption.');
  END IF;

  v_is_bonus := v_reward.category = 'point';
  v_mode := COALESCE(v_reward.collection_mode, 'always');

  IF v_is_bonus THEN
    v_change := COALESCE(v_reward.point_reward_amount, 0);
    IF v_change <= 0 THEN
      RETURN jsonb_build_object('success', false, 'status', 409, 'code', 'REWARD_MISCONFIGURED',
                                'error', 'This bonus is not available right now.');
    END IF;

    -- Earlier collections by this consumer (account or, for legacy rows, phone).
    IF v_mode IN ('once', 'daily') THEN
      SELECT count(*) INTO v_prior
        FROM public.points_transactions pt
       WHERE pt.redeem_item_id = p_reward_id
         AND (pt.user_id = p_user_id OR (v_phone <> '' AND pt.consumer_phone = v_phone))
         AND (v_mode = 'once' OR pt.created_at >= v_day_start);
      IF v_prior > 0 THEN
        IF v_mode = 'once' THEN
          RETURN jsonb_build_object('success', false, 'status', 400, 'code', 'ALREADY_COLLECTED',
                                    'error', 'You have already collected this reward. One-time collection only!');
        END IF;
        RETURN jsonb_build_object('success', false, 'status', 400, 'code', 'ALREADY_COLLECTED_TODAY',
                                  'error', 'You have already collected today! Come back tomorrow to collect again.');
      END IF;
    END IF;
  ELSE
    v_required := COALESCE(NULLIF(v_reward.point_offer, 0), v_reward.points_required, 0);
    IF v_required <= 0 THEN
      RETURN jsonb_build_object('success', false, 'status', 409, 'code', 'REWARD_MISCONFIGURED',
                                'error', 'This reward is not available right now.');
    END IF;
    IF v_reward.stock_quantity IS NOT NULL AND v_reward.stock_quantity <= 0 THEN
      RETURN jsonb_build_object('success', false, 'status', 400, 'code', 'OUT_OF_STOCK',
                                'error', 'This reward is out of stock');
    END IF;
    IF v_reward.max_redemptions_per_consumer IS NOT NULL AND v_reward.max_redemptions_per_consumer > 0 THEN
      SELECT count(*) INTO v_prior
        FROM public.points_transactions pt
       WHERE pt.redeem_item_id = p_reward_id
         AND pt.transaction_type = 'redeem'
         AND (pt.user_id = p_user_id OR (v_phone <> '' AND pt.consumer_phone = v_phone));
      IF v_prior >= v_reward.max_redemptions_per_consumer THEN
        RETURN jsonb_build_object('success', false, 'status', 400, 'code', 'LIMIT_REACHED',
                                  'error', format('You have reached the maximum redemption limit for this item (%s)',
                                                  v_reward.max_redemptions_per_consumer));
      END IF;
    END IF;
    v_change := -v_required;
  END IF;

  v_balance := public.consumer_reward_wallet_balance(p_user_id);

  IF NOT v_is_bonus AND v_balance < v_required THEN
    RETURN jsonb_build_object('success', false, 'status', 400, 'code', 'INSUFFICIENT_POINTS',
                              'error', format('Insufficient points. You need %s points but have %s.', v_required, v_balance),
                              'current_balance', v_balance, 'required', v_required);
  END IF;

  v_new_balance := v_balance + v_change;
  v_code := CASE WHEN v_is_bonus THEN 'BONUS-' ELSE 'RED-' END || upper(split_part(v_txn_id::text, '-', 1));

  INSERT INTO public.points_transactions (
    id, company_id, consumer_phone, consumer_email, transaction_type, points_amount, balance_after,
    wallet_scope, wallet_owner_user_id, wallet_owner_org_id, reporting_shop_id, wallet_balance_after,
    wallet_source, redeem_item_id, description, transaction_date, fulfillment_status, redemption_code,
    user_id, point_category, point_indicator, point_owner_type, point_direction
  ) VALUES (
    v_txn_id, NULL, v_phone, v_user.email,
    CASE WHEN v_is_bonus THEN 'earn' ELSE 'redeem' END, v_change, v_new_balance,
    'consumer', p_user_id, NULL, v_reporting_shop, v_new_balance,
    'mobile_consumer_reward', p_reward_id,
    CASE WHEN v_is_bonus THEN 'Bonus Points: ' ELSE 'Redeemed: ' END || v_reward.item_name,
    now(), CASE WHEN v_is_bonus THEN 'fulfilled' ELSE 'pending' END, v_code,
    p_user_id,
    CASE WHEN v_is_bonus THEN 'bonus' ELSE 'redemption' END,
    CASE WHEN v_is_bonus THEN 'point_reward' ELSE 'physical_reward' END,
    'consumer',
    CASE WHEN v_is_bonus THEN 'earn' ELSE 'debit' END
  );

  IF NOT v_is_bonus AND v_reward.stock_quantity IS NOT NULL THEN
    UPDATE public.redeem_items
       SET stock_quantity = stock_quantity - 1, updated_at = now()
     WHERE id = p_reward_id;
  END IF;

  IF p_request_key IS NOT NULL THEN
    INSERT INTO public.consumer_reward_requests (user_id, request_key, redeem_item_id, transaction_id)
    VALUES (p_user_id, p_request_key, p_reward_id, v_txn_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'status', 200, 'replayed', false,
    'transaction_id', v_txn_id,
    'is_bonus_points', v_is_bonus,
    'points_change', v_change,
    'required_points', v_required,
    'previous_balance', v_balance,
    'new_balance', v_new_balance,
    'redemption_code', v_code,
    'wallet_scope', 'consumer',
    'wallet_owner_user_id', p_user_id,
    'wallet_owner_org_id', NULL,
    'reporting_shop_id', v_reporting_shop);
END;
$$;

COMMENT ON FUNCTION public.consumer_reward_claim(uuid, uuid, text) IS
  'Atomic mobile consumer reward collection/redemption. service_role only; the caller passes the session-verified user id.';

REVOKE ALL ON FUNCTION public.consumer_reward_claim(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consumer_reward_claim(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Remove the non-staff redemption-debit INSERT policy
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS sa_member_redemption_debit_insert ON public.points_transactions;

-- ---------------------------------------------------------------------------
-- 5. Postconditions
-- ---------------------------------------------------------------------------
DO $post$
DECLARE
  v_fn regprocedure := 'public.consumer_reward_claim(uuid, uuid, text)'::regprocedure;
BEGIN
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION 'postcondition: consumer_reward_claim must be SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition: consumer_reward_claim must not be executable by anon/authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition: service_role must be able to execute consumer_reward_claim';
  END IF;
  IF has_function_privilege('anon', 'public.consumer_reward_wallet_balance(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.consumer_reward_wallet_balance(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition: consumer_reward_wallet_balance must not be executable by anon/authenticated';
  END IF;
  IF has_table_privilege('anon', 'public.consumer_reward_requests', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.consumer_reward_requests', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'postcondition: consumer_reward_requests must not be reachable by API roles';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.consumer_reward_requests'::regclass) THEN
    RAISE EXCEPTION 'postcondition: consumer_reward_requests must have RLS enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'points_transactions'
                AND policyname = 'sa_member_redemption_debit_insert') THEN
    RAISE EXCEPTION 'postcondition: sa_member_redemption_debit_insert must be dropped';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'points_transactions'
                AND cmd IN ('INSERT', 'ALL') AND policyname <> 'sa_company_staff_insert') THEN
    RAISE EXCEPTION 'postcondition: unexpected INSERT policy on points_transactions';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.points_transactions'::regclass) THEN
    RAISE EXCEPTION 'postcondition: points_transactions must keep RLS enabled';
  END IF;
END
$post$;
