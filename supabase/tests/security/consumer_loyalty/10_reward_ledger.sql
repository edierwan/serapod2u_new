-- ============================================================================
-- Customer / Loyalty secure writes — consumer_reward_claim regression tests
-- ----------------------------------------------------------------------------
-- DISPOSABLE DATABASES ONLY. Requires:
--   * a schema-only restore with every migration up to
--     20260929130000_consumer_reward_secure_ledger.sql applied
--   * supabase/tests/security/phase0b/00_harness_and_fixtures.sql (harness,
--     fixture users; it refuses to run when real users exist)
--
--   psql -X -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/security/phase0b/00_harness_and_fixtures.sql
--   psql -X -v ON_ERROR_STOP=1 -d <db> -f supabase/tests/security/consumer_loyalty/10_reward_ledger.sql
--
-- Concurrency (two sessions racing) is exercised by
-- supabase/tests/security/consumer_loyalty/concurrency.sh.
--
-- Fixtures used from the harness:
--   consumer  GUEST, no organization      -> independent consumer wallet
--   shop_a    GUEST in SHOP A             -> shop-linked consumer wallet
--   wh_a1     WH user in a warehouse org  -> not a mobile consumer
--   hq_a      HQ admin                    -> company staff
-- ============================================================================

DROP SCHEMA IF EXISTS cl_test CASCADE;
CREATE SCHEMA cl_test;
GRANT USAGE ON SCHEMA cl_test TO PUBLIC;

-- Calls the ledger RPC exactly like the Next.js route: as service_role.
CREATE FUNCTION cl_test.claim(p_user uuid, p_reward uuid, p_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  PERFORM set_config('role', 'service_role', true);
  r := public.consumer_reward_claim(p_user, p_reward, p_key);
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN r;
END $$;

CREATE FUNCTION cl_test.rid(p_name text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_name
    WHEN 'daily'      THEN '00000000-0000-0000-0000-0000000f0001'
    WHEN 'once'       THEN '00000000-0000-0000-0000-0000000f0002'
    WHEN 'rm100'      THEN '00000000-0000-0000-0000-0000000f0003'
    WHEN 'limited'    THEN '00000000-0000-0000-0000-0000000f0004'
    WHEN 'soldout'    THEN '00000000-0000-0000-0000-0000000f0005'
    WHEN 'expensive'  THEN '00000000-0000-0000-0000-0000000f0006'
    WHEN 'inactive'   THEN '00000000-0000-0000-0000-0000000f0007'
    WHEN 'shopwallet' THEN '00000000-0000-0000-0000-0000000f0008'
    WHEN 'zerobonus'  THEN '00000000-0000-0000-0000-0000000f0009'
  END::uuid
$$;

CREATE FUNCTION cl_test.balance(p_user uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT public.consumer_reward_wallet_balance(p_user)
$$;

CREATE FUNCTION cl_test.rows_for(p_user uuid, p_reward uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.points_transactions WHERE user_id = p_user AND redeem_item_id = p_reward
$$;

CREATE FUNCTION cl_test.check(p_label text, p_ok boolean, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL [%]: %', p_label, COALESCE(p_detail, 'condition false');
  END IF;
  RAISE NOTICE 'PASS [%]', p_label;
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA cl_test TO PUBLIC;

-- Reward catalog (company A).
INSERT INTO public.redeem_items
  (id, company_id, item_code, item_name, points_required, point_offer, stock_quantity,
   max_redemptions_per_consumer, is_active, category, point_reward_amount, collection_mode,
   per_user_limit, wallet_scope)
VALUES
  (cl_test.rid('daily'),      phase0b_test.org('hq_a'), 'QA-DAILY',     'QA Daily Point',   0,      NULL, NULL, NULL, true,  'point', 5,  'daily',  false, 'consumer'),
  (cl_test.rid('once'),       phase0b_test.org('hq_a'), 'QA-ONCE',      'QA Welcome Point', 0,      NULL, NULL, NULL, true,  'point', 10, 'once',   true,  'consumer'),
  (cl_test.rid('rm100'),      phase0b_test.org('hq_a'), 'QA-RM100',     'QA RM100 CASH',    1500,   NULL, 3,    NULL, true,  'other', NULL, 'always', false, 'consumer'),
  (cl_test.rid('limited'),    phase0b_test.org('hq_a'), 'QA-LIMITED',   'QA Limited',       100,    NULL, NULL, 1,    true,  'other', NULL, 'always', false, 'consumer'),
  (cl_test.rid('soldout'),    phase0b_test.org('hq_a'), 'QA-SOLDOUT',   'QA Sold Out',      100,    NULL, 0,    NULL, true,  'other', NULL, 'always', false, 'consumer'),
  (cl_test.rid('expensive'),  phase0b_test.org('hq_a'), 'QA-EXPENSIVE', 'QA Expensive',     999999, NULL, 5,    NULL, true,  'other', NULL, 'always', false, 'consumer'),
  (cl_test.rid('inactive'),   phase0b_test.org('hq_a'), 'QA-INACTIVE',  'QA Inactive',      100,    NULL, NULL, NULL, false, 'other', NULL, 'always', false, 'consumer'),
  (cl_test.rid('shopwallet'), phase0b_test.org('hq_a'), 'QA-SHOPWAL',   'QA Shop Wallet',   100,    NULL, NULL, NULL, true,  'other', NULL, 'always', false, 'shop'),
  (cl_test.rid('zerobonus'),  phase0b_test.org('hq_a'), 'QA-ZERO',      'QA Zero Bonus',    0,      NULL, NULL, NULL, true,  'point', 0,  'always', false, 'consumer');

-- Opening balances (server-written, like QR collection would).
INSERT INTO public.points_transactions (company_id, user_id, consumer_phone, transaction_type, points_amount, balance_after, wallet_scope, wallet_owner_user_id)
VALUES
  (NULL, phase0b_test.uid('consumer'), '+60110000006', 'earn', 2000, 2000, 'consumer', phase0b_test.uid('consumer')),
  (NULL, phase0b_test.uid('shop_a'),   '+60110000005', 'earn', 2000, 2000, 'consumer', phase0b_test.uid('shop_a'));

DO $t$
DECLARE
  v_consumer uuid := phase0b_test.uid('consumer');
  v_shop     uuid := phase0b_test.uid('shop_a');
  r jsonb; r2 jsonb;
  v_before bigint; v_stock integer; v_row record; v_count integer;
BEGIN
  -- -------------------------------------------------------------------------
  -- WALLET BALANCE SOURCE
  -- -------------------------------------------------------------------------
  PERFORM cl_test.check('wallet balance helper reads the opening balance (independent)', cl_test.balance(v_consumer) = 2000);
  PERFORM cl_test.check('wallet balance helper reads the opening balance (shop-linked)', cl_test.balance(v_shop) = 2000);
  PERFORM cl_test.check('wallet balance helper matches v_consumer_points_balance wherever the view lists the user',
    NOT EXISTS (SELECT 1 FROM public.v_consumer_points_balance b
                 WHERE b.current_balance IS DISTINCT FROM public.consumer_reward_wallet_balance(b.user_id)));

  -- -------------------------------------------------------------------------
  -- BONUS
  -- -------------------------------------------------------------------------
  v_before := cl_test.balance(v_consumer);
  r := cl_test.claim(v_consumer, cl_test.rid('daily'));
  PERFORM cl_test.check('eligible daily bonus succeeds (independent consumer)', (r->>'success')::boolean, r::text);
  PERFORM cl_test.check('daily bonus credits the configured amount', (r->>'points_change')::int = 5, r::text);
  PERFORM cl_test.check('daily bonus balance_after is previous + credit', (r->>'new_balance')::bigint = v_before + 5, r::text);
  PERFORM cl_test.check('wallet balance reflects the credit', cl_test.balance(v_consumer) = v_before + 5);
  PERFORM cl_test.check('exactly one bonus row', cl_test.rows_for(v_consumer, cl_test.rid('daily')) = 1);

  SELECT * INTO v_row FROM public.points_transactions WHERE id = (r->>'transaction_id')::uuid;
  PERFORM cl_test.check('bonus row belongs to the consumer wallet',
    v_row.user_id = v_consumer AND v_row.wallet_owner_user_id = v_consumer AND v_row.wallet_scope = 'consumer'
    AND v_row.wallet_owner_org_id IS NULL AND v_row.company_id IS NULL, row_to_json(v_row)::text);
  PERFORM cl_test.check('independent consumer has no reporting shop', v_row.reporting_shop_id IS NULL);
  PERFORM cl_test.check('bonus row is an earn with reward reference',
    v_row.transaction_type = 'earn' AND v_row.points_amount = 5 AND v_row.redeem_item_id = cl_test.rid('daily')
    AND v_row.balance_after = v_before + 5 AND v_row.wallet_balance_after = v_before + 5
    AND v_row.wallet_source = 'mobile_consumer_reward' AND v_row.point_category = 'bonus');
  PERFORM cl_test.check('bonus code is final and derived from the row id',
    v_row.redemption_code = 'BONUS-' || upper(split_part(v_row.id::text, '-', 1)), v_row.redemption_code);

  r := cl_test.claim(v_consumer, cl_test.rid('daily'), 'second-claim-key');
  PERFORM cl_test.check('second same-day daily claim denied', r->>'code' = 'ALREADY_COLLECTED_TODAY', r::text);
  PERFORM cl_test.check('no second daily row', cl_test.rows_for(v_consumer, cl_test.rid('daily')) = 1);

  -- Yesterday's collection does not block today's.
  INSERT INTO public.points_transactions (company_id, user_id, consumer_phone, transaction_type, points_amount, balance_after, redeem_item_id, created_at)
  VALUES (NULL, v_shop, '+60110000005', 'earn', 5, 2005, cl_test.rid('daily'), now() - interval '1 day');
  r := cl_test.claim(v_shop, cl_test.rid('daily'));
  PERFORM cl_test.check('daily bonus available again the next day (shop-linked consumer)', (r->>'success')::boolean, r::text);
  SELECT * INTO v_row FROM public.points_transactions WHERE id = (r->>'transaction_id')::uuid;
  PERFORM cl_test.check('shop-linked consumer keeps an individual wallet with shop attribution',
    v_row.wallet_scope = 'consumer' AND v_row.wallet_owner_user_id = v_shop AND v_row.wallet_owner_org_id IS NULL
    AND v_row.reporting_shop_id = phase0b_test.org('shop_a'), row_to_json(v_row)::text);

  r := cl_test.claim(v_consumer, cl_test.rid('once'), 'once-key-1');
  PERFORM cl_test.check('one-time bonus succeeds first time', (r->>'success')::boolean, r::text);
  r := cl_test.claim(v_consumer, cl_test.rid('once'), 'once-key-2');
  PERFORM cl_test.check('one-time bonus cannot repeat with a new request key', r->>'code' = 'ALREADY_COLLECTED', r::text);
  r := cl_test.claim(v_consumer, cl_test.rid('once'));
  PERFORM cl_test.check('one-time bonus cannot repeat without a key', r->>'code' = 'ALREADY_COLLECTED', r::text);
  PERFORM cl_test.check('one-time bonus written once', cl_test.rows_for(v_consumer, cl_test.rid('once')) = 1);

  r := cl_test.claim(v_consumer, cl_test.rid('zerobonus'));
  PERFORM cl_test.check('zero-amount bonus is refused, nothing written',
    r->>'code' = 'REWARD_MISCONFIGURED' AND cl_test.rows_for(v_consumer, cl_test.rid('zerobonus')) = 0, r::text);

  -- -------------------------------------------------------------------------
  -- REDEMPTION
  -- -------------------------------------------------------------------------
  v_before := cl_test.balance(v_shop);
  r := cl_test.claim(v_shop, cl_test.rid('rm100'), 'rm100-confirm-1');
  PERFORM cl_test.check('valid RM100 redemption succeeds', (r->>'success')::boolean, r::text);
  PERFORM cl_test.check('redemption deducts exactly the reward price',
    (r->>'points_change')::int = -1500 AND (r->>'required_points')::int = 1500, r::text);
  PERFORM cl_test.check('redemption balance_after correct', (r->>'new_balance')::bigint = v_before - 1500, r::text);
  PERFORM cl_test.check('wallet balance reduced once', cl_test.balance(v_shop) = v_before - 1500);
  SELECT stock_quantity INTO v_stock FROM public.redeem_items WHERE id = cl_test.rid('rm100');
  PERFORM cl_test.check('stock decremented by one', v_stock = 2, v_stock::text);
  SELECT * INTO v_row FROM public.points_transactions WHERE id = (r->>'transaction_id')::uuid;
  PERFORM cl_test.check('redemption row shape',
    v_row.transaction_type = 'redeem' AND v_row.points_amount = -1500 AND v_row.fulfillment_status = 'pending'
    AND v_row.redemption_code = 'RED-' || upper(split_part(v_row.id::text, '-', 1))
    AND v_row.reporting_shop_id = phase0b_test.org('shop_a') AND v_row.point_direction = 'debit', row_to_json(v_row)::text);

  r2 := cl_test.claim(v_shop, cl_test.rid('rm100'), 'rm100-confirm-1');
  PERFORM cl_test.check('retry with the same request key replays the original result',
    (r2->>'success')::boolean AND (r2->>'replayed')::boolean AND r2->>'transaction_id' = r->>'transaction_id'
    AND (r2->>'new_balance')::bigint = v_before - 1500 AND r2->>'redemption_code' = r->>'redemption_code', r2::text);
  PERFORM cl_test.check('retry does not deduct twice', cl_test.balance(v_shop) = v_before - 1500);
  PERFORM cl_test.check('retry writes no second row', cl_test.rows_for(v_shop, cl_test.rid('rm100')) = 1);
  SELECT stock_quantity INTO v_stock FROM public.redeem_items WHERE id = cl_test.rid('rm100');
  PERFORM cl_test.check('retry does not take stock twice', v_stock = 2, v_stock::text);

  r2 := cl_test.claim(v_shop, cl_test.rid('limited'), 'rm100-confirm-1');
  PERFORM cl_test.check('request key cannot be reused for another reward', r2->>'code' = 'REQUEST_KEY_REUSED', r2::text);
  PERFORM cl_test.check('reused key wrote nothing', cl_test.rows_for(v_shop, cl_test.rid('limited')) = 0);

  v_before := cl_test.balance(v_consumer);
  r := cl_test.claim(v_consumer, cl_test.rid('expensive'), 'expensive-1');
  PERFORM cl_test.check('insufficient balance denied with balance details',
    r->>'code' = 'INSUFFICIENT_POINTS' AND (r->>'current_balance')::bigint = v_before AND (r->>'required')::int = 999999, r::text);
  PERFORM cl_test.check('insufficient balance: no ledger write', cl_test.rows_for(v_consumer, cl_test.rid('expensive')) = 0);
  PERFORM cl_test.check('insufficient balance: balance unchanged', cl_test.balance(v_consumer) = v_before);
  SELECT stock_quantity INTO v_stock FROM public.redeem_items WHERE id = cl_test.rid('expensive');
  PERFORM cl_test.check('insufficient balance: stock unchanged', v_stock = 5, v_stock::text);
  PERFORM cl_test.check('insufficient balance: key not consumed',
    NOT EXISTS (SELECT 1 FROM public.consumer_reward_requests WHERE request_key = 'expensive-1'));

  r := cl_test.claim(v_consumer, cl_test.rid('soldout'));
  PERFORM cl_test.check('out of stock denied, nothing written',
    r->>'code' = 'OUT_OF_STOCK' AND cl_test.rows_for(v_consumer, cl_test.rid('soldout')) = 0, r::text);

  r := cl_test.claim(v_consumer, cl_test.rid('limited'), 'limited-1');
  PERFORM cl_test.check('limited item first redemption succeeds', (r->>'success')::boolean, r::text);
  r := cl_test.claim(v_consumer, cl_test.rid('limited'), 'limited-2');
  PERFORM cl_test.check('per-consumer redemption limit enforced', r->>'code' = 'LIMIT_REACHED', r::text);

  r := cl_test.claim(v_consumer, cl_test.rid('inactive'));
  PERFORM cl_test.check('inactive reward refused', r->>'code' = 'REWARD_NOT_FOUND', r::text);
  r := cl_test.claim(v_consumer, cl_test.rid('shopwallet'));
  PERFORM cl_test.check('shop-wallet reward refused on mobile', r->>'code' = 'SHOP_WALLET_DISABLED', r::text);
  r := cl_test.claim(phase0b_test.uid('wh_a1'), cl_test.rid('daily'));
  PERFORM cl_test.check('non-shop organization user refused', r->>'code' = 'ORG_NOT_ALLOWED', r::text);
  r := cl_test.claim('00000000-0000-0000-0000-0000000fffff', cl_test.rid('daily'));
  PERFORM cl_test.check('unknown user refused', r->>'code' = 'USER_NOT_FOUND', r::text);
  r := cl_test.claim(v_consumer, cl_test.rid('daily'), 'short');
  PERFORM cl_test.check('malformed request key refused', r->>'code' = 'INVALID_REQUEST', r::text);

  -- -------------------------------------------------------------------------
  -- SECURITY
  -- -------------------------------------------------------------------------
  PERFORM cl_test.check('anon cannot execute consumer_reward_claim',
    NOT has_function_privilege('anon', 'public.consumer_reward_claim(uuid,uuid,text)', 'EXECUTE'));
  PERFORM cl_test.check('authenticated cannot execute consumer_reward_claim',
    NOT has_function_privilege('authenticated', 'public.consumer_reward_claim(uuid,uuid,text)', 'EXECUTE'));
  PERFORM cl_test.check('API roles cannot execute the wallet balance helper',
    NOT has_function_privilege('anon', 'public.consumer_reward_wallet_balance(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.consumer_reward_wallet_balance(uuid)', 'EXECUTE'));
  PERFORM cl_test.check('service_role can execute consumer_reward_claim',
    has_function_privilege('service_role', 'public.consumer_reward_claim(uuid,uuid,text)', 'EXECUTE'));

  PERFORM phase0b_test.expect_denied('consumer A cannot call the ledger RPC to credit consumer B', 'authenticated', v_consumer,
    format('SELECT public.consumer_reward_claim(%L, %L, NULL)', v_shop, cl_test.rid('daily')));
  PERFORM phase0b_test.expect_denied('consumer cannot call the ledger RPC for themselves either', 'authenticated', v_consumer,
    format('SELECT public.consumer_reward_claim(%L, %L, NULL)', v_consumer, cl_test.rid('daily')));
  PERFORM phase0b_test.expect_denied('anon cannot call the ledger RPC', 'anon', NULL,
    format('SELECT public.consumer_reward_claim(%L, %L, NULL)', v_consumer, cl_test.rid('daily')));

  PERFORM phase0b_test.expect_denied('independent consumer direct positive INSERT denied', 'authenticated', v_consumer,
    format('INSERT INTO public.points_transactions (company_id, user_id, consumer_phone, transaction_type, points_amount, balance_after, redeem_item_id) VALUES (NULL, %L, %L, %L, 1000, 99999, %L)',
           v_consumer, '+60110000006', 'earn', cl_test.rid('daily')));
  PERFORM phase0b_test.expect_denied('shop-linked consumer direct positive INSERT denied', 'authenticated', v_shop,
    format('INSERT INTO public.points_transactions (company_id, user_id, consumer_phone, transaction_type, points_amount, balance_after) VALUES (%L, %L, %L, %L, 1000, 99999)',
           phase0b_test.org('hq_a'), v_shop, '+60110000005', 'earn'));
  PERFORM phase0b_test.expect_denied('consumer cannot credit another consumer directly', 'authenticated', v_consumer,
    format('INSERT INTO public.points_transactions (company_id, user_id, wallet_scope, wallet_owner_user_id, consumer_phone, transaction_type, points_amount, balance_after) VALUES (NULL, %L, %L, %L, %L, %L, 1000, 99999)',
           v_shop, 'consumer', v_shop, '+60110000005', 'earn'));
  PERFORM phase0b_test.expect_denied('shop-linked consumer cannot debit another consumer', 'authenticated', v_shop,
    format('INSERT INTO public.points_transactions (company_id, user_id, wallet_scope, wallet_owner_user_id, consumer_phone, transaction_type, points_amount, balance_after) VALUES (%L, %L, %L, %L, %L, %L, -1000, 0)',
           phase0b_test.org('hq_a'), v_consumer, 'consumer', v_consumer, '+60110000006', 'redeem'));
  PERFORM phase0b_test.expect_denied('consumer cannot self-record a cheap redemption of an expensive reward', 'authenticated', v_shop,
    format('INSERT INTO public.points_transactions (company_id, user_id, consumer_phone, transaction_type, points_amount, balance_after, redeem_item_id) VALUES (%L, %L, %L, %L, -1, 0, %L)',
           phase0b_test.org('shop_a'), v_shop, '+60110000005', 'redeem', cl_test.rid('expensive')));
  PERFORM phase0b_test.expect_count('consumer cannot rewrite own ledger rows', 'authenticated', v_consumer,
    'WITH u AS (UPDATE public.points_transactions SET points_amount = 999999 WHERE user_id = auth.uid() RETURNING 1) SELECT count(*) FROM u', 0);
  PERFORM phase0b_test.expect_count('consumer cannot see idempotency records', 'authenticated', v_consumer,
    'SELECT count(*) FROM public.consumer_reward_requests', -1);
  PERFORM phase0b_test.expect_denied('consumer cannot forge idempotency records', 'authenticated', v_consumer,
    format('INSERT INTO public.consumer_reward_requests (user_id, request_key, redeem_item_id, transaction_id) VALUES (%L, %L, %L, %L)',
           v_consumer, 'forged-key-1', cl_test.rid('rm100'), (SELECT id FROM public.points_transactions LIMIT 1)));
  PERFORM phase0b_test.expect_count('consumer sees no other consumer ledger rows', 'authenticated', v_consumer,
    'SELECT count(*)::int FROM public.points_transactions WHERE user_id <> auth.uid() AND wallet_owner_user_id IS DISTINCT FROM auth.uid()', 0);

  PERFORM phase0b_test.expect_ok('company staff manual adjustment still allowed', 'authenticated', phase0b_test.uid('hq_a'),
    format('INSERT INTO public.points_transactions (company_id, user_id, consumer_phone, transaction_type, points_amount, balance_after) VALUES (%L, %L, %L, %L, 10, 10)',
           phase0b_test.org('hq_a'), v_consumer, '+60110000006', 'adjust'));

  PERFORM cl_test.check('points_transactions RLS still enabled',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.points_transactions'::regclass));
  SELECT count(*) INTO v_count FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'points_transactions' AND cmd IN ('INSERT', 'ALL');
  PERFORM cl_test.check('only the company-staff INSERT policy remains', v_count = 1, v_count::text);
  PERFORM cl_test.check('QR collection RPC stays service-only',
    NOT has_function_privilege('authenticated', 'public.consumer_collect_points(text,text,numeric,text,boolean)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.consumer_collect_points(text,text,numeric,text,boolean)', 'EXECUTE'));
END
$t$;
