# Reward Redemption Historical Cleanup Plan

Date: 2026-05-20
Status: Draft only. Investigation and repair planning document. No SQL in this file has been executed.

## Scope

This document covers historical production rows that appear consumer-scoped but currently affect shop aggregates through `company_id` ownership or `shop_points_ledger` phone/email fallback.

The goal is to prepare a manual-review cleanup plan after the new individual-wallet model is deployed for new rows.

## Verified Historical Risk Counts

- Total redemption rows in production: `39`
- Redemption rows affecting both consumer and shop balances: `27`
- Redemption rows with `company_id = null` that still map into `shop_points_ledger`: `18`
- Negative shops currently driven by redemption rows: `11`
- Redemption rows currently feeding negative shops: `19`

These counts came from the read-only production investigation documented in [docs/issues/2026-05-19-reward-redemption-wallet-scope-investigation.md](docs/issues/2026-05-19-reward-redemption-wallet-scope-investigation.md).

## Which Historical Rows Look Consumer-Scoped But Affected Shop Aggregate

The highest-risk rows have this pattern:

- `points_transactions.transaction_type = 'redeem'`
- `user_id IS NOT NULL`
- `company_id IS NULL`
- `balance_after` clearly reflects an individual wallet balance
- the row still appears in `shop_points_ledger` because the live view derives `shop_id` from `consumer_phone` or `consumer_email`

Confirmed sample rows from the investigation:

- `aa4e9563-fec1-4262-a8dd-c0070cb82630` -> Allfan -> derived to Brew Beauty -> `RM1000 CASH`
- `eda78630-2d26-460b-acae-b91394ef9ee2` -> derived to Curry Puaka Vape -> `RM500 CASH`
- `49be7223-059b-4379-b77a-9ed7e253ac35` -> derived to Kami Studio -> `RM500 CASH`
- `ef91641a-cc7d-4eb6-806b-6ac92817271e` -> derived to Yan Vape Zone -> `RM500 CASH`

These rows are the clearest historical candidates for repair once the new wallet model is stable.

## Negative Shops Caused By Redemption Rows

Production investigation results:

- Shops with negative balances: `11`
- Negative shops with redemption rows: `11`
- Negative shops with manual adjustments contributing to negativity: `0`

This strongly suggests that the existing negative shop balances are a historical attribution problem, not a manual-adjustment problem.

## Cleanup Strategy Recommendation

Recommended order:

1. Deploy the new explicit wallet-owner model for new rows first.
2. Freeze the meaning of new columns:
   - `wallet_scope`
   - `wallet_owner_user_id`
   - `wallet_owner_org_id`
   - `reporting_shop_id`
   - `wallet_balance_after`
3. Re-run the read-only verification queries after deployment to separate:
   - historical contaminated rows
   - new correctly-attributed rows
4. Repair historical rows in batches with explicit review checkpoints.
5. Rebuild or replace any reporting views that still derive shop ownership from phone/email for consumer redemptions.

Recommended repair principle:

- Historical consumer redemptions should remain consumer-wallet spends.
- Shop attribution should move to `reporting_shop_id` when there is clear supporting evidence.
- Historical `company_id` should not continue to imply shop wallet ownership for consumer redemptions.

## Draft Repair Approach

### Phase A: annotate only

- Backfill explicit wallet metadata on historical redemptions without changing `points_amount`.
- Populate:
  - `wallet_scope = 'consumer'`
  - `wallet_owner_user_id = user_id`
  - `wallet_owner_org_id = null`
  - `wallet_balance_after = balance_after`
  - `reporting_shop_id = derived shop when evidence is strong`
  - `wallet_source = 'historical_cleanup_reviewed'`

### Phase B: reporting isolation

- Update reporting queries and views to use:
  - explicit `reporting_shop_id` for consumer redemptions
  - attached-user aggregation for shop summaries
- Stop using phone/email fallback to infer shop wallet ownership for repaired consumer redemptions.

### Phase C: optional shop-ledger repair

- If legacy `shop_points_ledger` must still exist, adjust the transaction-side branch so consumer redemptions do not feed shop spendable balances.
- Prefer replacing spendable shop balance usage with reporting-only views.

## Rollback Strategy

If any historical cleanup script later proves incorrect:

1. Only run idempotent, reviewable updates inside a transaction or staged batch.
2. Snapshot affected rows before each batch into a review table or export file.
3. Keep a pre-change export with:
   - `id`
   - `user_id`
   - `company_id`
   - `consumer_phone`
   - `consumer_email`
   - `points_amount`
   - `balance_after`
   - new wallet fields
4. Roll back by restoring the pre-change values for only the affected batch.

## Read-Only Verification SQL

These are the verification queries to run before any repair. They are safe and read-only.

```sql
SELECT COUNT(*) AS total_redemptions
FROM public.points_transactions
WHERE transaction_type = 'redeem';
```

```sql
SELECT COUNT(*) AS dual_impact_redemptions
FROM public.points_transactions pt
WHERE pt.transaction_type = 'redeem'
  AND EXISTS (
    SELECT 1
    FROM public.v_consumer_points_balance v
    WHERE v.user_id = pt.user_id
  )
  AND EXISTS (
    SELECT 1
    FROM public.shop_points_ledger spl
    WHERE spl.id = pt.id
      AND spl.shop_id IS NOT NULL
  );
```

```sql
SELECT COUNT(*) AS derived_shop_redemptions
FROM public.points_transactions pt
JOIN public.shop_points_ledger spl ON spl.id = pt.id
WHERE pt.transaction_type = 'redeem'
  AND pt.company_id IS NULL
  AND spl.shop_id IS NOT NULL;
```

```sql
SELECT COUNT(*) AS negative_shops
FROM public.v_shop_points_balance
WHERE current_balance < 0;
```

```sql
SELECT shop_id, current_balance
FROM public.v_shop_points_balance
WHERE current_balance < 0
ORDER BY current_balance ASC;
```

## Draft Repair SQL For Manual Review Only

Do not execute these statements as-is. They are placeholders for later review.

### Draft 1: annotate historical consumer redemptions

```sql
-- DRAFT ONLY. DO NOT EXECUTE.
UPDATE public.points_transactions pt
SET
  wallet_scope = 'consumer',
  wallet_owner_user_id = pt.user_id,
  wallet_owner_org_id = NULL,
  wallet_balance_after = pt.balance_after,
  reporting_shop_id = derived.shop_id,
  wallet_source = 'historical_cleanup_reviewed'
FROM (
  SELECT DISTINCT ON (spl.id)
    spl.id,
    spl.shop_id
  FROM public.shop_points_ledger spl
  WHERE spl.transaction_type = 'redeem'
    AND spl.shop_id IS NOT NULL
) AS derived
WHERE pt.id = derived.id
  AND pt.transaction_type = 'redeem'
  AND pt.user_id IS NOT NULL;
```

### Draft 2: isolate shop reporting from legacy wallet ownership

```sql
-- DRAFT ONLY. DO NOT EXECUTE.
CREATE OR REPLACE VIEW public.v_shop_user_points_reporting_repair_preview AS
SELECT *
FROM public.v_shop_user_points_reporting;
```

## Operational Recommendation

Do not mix the forward fix with historical cleanup in one release.

Recommended sequence:

1. Apply schema migration for new wallet fields and reward wallet scope.
2. Deploy app changes that write explicit wallet ownership for new mobile redemptions.
3. Verify new rows are correct with read-only SQL.
4. Only then draft and review historical repair batches.