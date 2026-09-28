#!/usr/bin/env bash
# ============================================================================
# consumer_reward_claim concurrency regression (DISPOSABLE DATABASES ONLY)
# ----------------------------------------------------------------------------
# Run after 10_reward_ledger.sql on the same throwaway database:
#   PSQL="psql -X -q -h 127.0.0.1 -p 55440 -U supabase_admin" \
#     supabase/tests/security/consumer_loyalty/concurrency.sh <db>
#
# Races N parallel sessions (as service_role, like the Next.js route) and
# checks that only one ledger effect survives:
#   1. N simultaneous daily-bonus claims for a fresh consumer   -> 1 credit
#   2. N simultaneous redemptions, balance for exactly one      -> 1 debit
#   3. N simultaneous retries of one confirmation (same key)    -> 1 debit
# ============================================================================
set -euo pipefail
DB="${1:?database name required}"
PSQL="${PSQL:-psql -X -q}"
N="${N:-12}"
q() { $PSQL -d "$DB" -v ON_ERROR_STOP=1 -Atc "$1"; }

if [ "$(q "SELECT count(*) FROM public.users WHERE id::text NOT LIKE '00000000-0000-0000-0000-0000000%'")" != "0" ]; then
  echo "Refusing to run: database contains non-fixture users" >&2; exit 1
fi

CONSUMER=00000000-0000-0000-0000-000000000031
DAILY=00000000-0000-0000-0000-0000000f0001
RACE=00000000-0000-0000-0000-0000000f0010
HQ=00000000-0000-0000-0000-00000000a001

q "DELETE FROM public.consumer_reward_requests WHERE user_id = '$CONSUMER';
   DELETE FROM public.points_transactions WHERE user_id = '$CONSUMER';
   DELETE FROM public.users WHERE id = '$CONSUMER';
   DELETE FROM auth.users WHERE id = '$CONSUMER';
   DELETE FROM public.redeem_items WHERE id = '$RACE';
   INSERT INTO auth.users (id, email) VALUES ('$CONSUMER', 'race@consumer-loyalty.test');
   INSERT INTO public.users (id, email, role_code, organization_id, is_active, full_name, phone)
     VALUES ('$CONSUMER', 'race@consumer-loyalty.test', 'GUEST', NULL, true, 'Race consumer', '+60110000031');
   INSERT INTO public.points_transactions (company_id, user_id, consumer_phone, transaction_type, points_amount, balance_after)
     VALUES (NULL, '$CONSUMER', '+60110000031', 'earn', 1500, 1500);
   INSERT INTO public.redeem_items (id, company_id, item_code, item_name, points_required, stock_quantity, is_active, category, collection_mode, per_user_limit, wallet_scope)
     VALUES ('$RACE', '$HQ', 'QA-RACE', 'QA Race RM100', 1000, 10, true, 'other', 'always', false, 'consumer');"

claim() { # <reward> <key|NULL>
  $PSQL -d "$DB" -Atc "SET ROLE service_role; SELECT public.consumer_reward_claim('$CONSUMER', '$1', $2)->>'success';"
}

fail() { echo "FAIL [$1]: $2" >&2; exit 1; }
pass() { echo "PASS [$1]"; }

# 1. Daily bonus race.
for i in $(seq "$N"); do claim "$DAILY" NULL & done > /dev/null; wait
c=$(q "SELECT count(*) FROM public.points_transactions WHERE user_id = '$CONSUMER' AND redeem_item_id = '$DAILY'")
[ "$c" = "1" ] || fail "concurrent daily bonus claims credit once" "rows=$c"
pass "concurrent daily bonus claims credit once ($N racers)"

# 2. Redemption race with distinct keys; balance (1505) covers exactly one 1000-point redemption.
for i in $(seq "$N"); do claim "$RACE" "'race-distinct-$i'" & done > /dev/null; wait
c=$(q "SELECT count(*) FROM public.points_transactions WHERE user_id = '$CONSUMER' AND redeem_item_id = '$RACE'")
b=$(q "SELECT public.consumer_reward_wallet_balance('$CONSUMER')")
s=$(q "SELECT stock_quantity FROM public.redeem_items WHERE id = '$RACE'")
[ "$c" = "1" ] || fail "concurrent redemptions never overdraw" "rows=$c"
[ "$b" = "505" ] || fail "balance after concurrent redemptions" "balance=$b"
[ "$s" = "9" ] || fail "stock after concurrent redemptions" "stock=$s"
pass "concurrent redemptions never overdraw (1 debit, balance 505, stock 9)"

# 3. Double-click / retry race: same key, enough balance for several.
q "INSERT INTO public.points_transactions (company_id, user_id, consumer_phone, transaction_type, points_amount, balance_after)
     VALUES (NULL, '$CONSUMER', '+60110000031', 'earn', 5000, 5505)"
for i in $(seq "$N"); do claim "$RACE" "'double-click-key-1'" & done > /dev/null; wait
c=$(q "SELECT count(*) FROM public.points_transactions WHERE user_id = '$CONSUMER' AND redeem_item_id = '$RACE'")
b=$(q "SELECT public.consumer_reward_wallet_balance('$CONSUMER')")
s=$(q "SELECT stock_quantity FROM public.redeem_items WHERE id = '$RACE'")
[ "$c" = "2" ] || fail "retried confirmation deducts once" "rows=$c"
[ "$b" = "4505" ] || fail "balance after retried confirmation" "balance=$b"
[ "$s" = "8" ] || fail "stock after retried confirmation" "stock=$s"
pass "retried confirmation deducts once (same key, $N racers)"
