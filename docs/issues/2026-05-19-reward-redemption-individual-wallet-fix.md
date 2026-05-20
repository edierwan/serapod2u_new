# Reward Redemption Individual Wallet Fix

Date: 2026-05-20
Status: Implemented in repo only. No production data changed. Migration created but not applied.

## Final Business Rule

The chosen product model is individual wallet for mobile rewards.

- Every mobile user redeems from their own individual wallet only.
- Shop totals are reporting and performance summaries only.
- Mobile redemption must never use `v_shop_points_balance` as the spendable source.
- A redemption may still be attributed to a shop for reporting, but wallet ownership remains the user.

## DB Model Before

Previous behavior mixed wallet ownership and reporting attribution:

- `points_transactions.user_id` made redemptions affect the consumer balance.
- `points_transactions.company_id` or phone/email fallback could also make the same redemption affect `shop_points_ledger`.
- `redeem_items` had no explicit wallet scope.
- Shop reporting and shop spendable balance were effectively conflated.

## DB Model After

New migration file: [supabase/migrations/20260520_reward_redemption_individual_wallet.sql](supabase/migrations/20260520_reward_redemption_individual_wallet.sql)

New `points_transactions` fields for future rows:

- `wallet_scope`
- `wallet_owner_user_id`
- `wallet_owner_org_id`
- `reporting_shop_id`
- `wallet_balance_after`
- `wallet_source`

New `redeem_items` field:

- `wallet_scope` default `'consumer'`

New reporting view:

- `v_shop_user_points_reporting`

Important safety choice:

- The migration does not rewrite historical `points_transactions` wallet ownership automatically.
- Existing rewards are backfilled to `wallet_scope = 'consumer'` in the migration file.

## Code Paths Changed

### Shared wallet resolution

- [app/src/lib/utils/qr-resolver.ts](app/src/lib/utils/qr-resolver.ts)
  - added `resolveMobileConsumerWalletContext(...)`
  - added explicit mobile wallet classification metadata

### Consumer redemption planning

- [app/src/lib/engagement/consumer-reward-wallet.ts](app/src/lib/engagement/consumer-reward-wallet.ts)
  - centralizes consumer reward eligibility and transaction payload creation

### Mobile profile and rewards

- [app/src/app/api/user/profile/route.ts](app/src/app/api/user/profile/route.ts)
  - now uses the shared mobile consumer wallet resolver
  - returns wallet metadata alongside `pointsBalance`

- [app/src/app/api/consumer/rewards/route.ts](app/src/app/api/consumer/rewards/route.ts)
  - now filters to consumer-scoped rewards only

- [app/src/app/api/consumer/redeem-reward/route.ts](app/src/app/api/consumer/redeem-reward/route.ts)
  - no longer uses local role logic to pick shop balance
  - uses the shared mobile consumer wallet resolver
  - writes consumer redemptions with explicit wallet-owner fields
  - uses `company_id = null` for consumer/mobile redemption rows
  - returns wallet metadata in the API response

### Mobile personal history

- [app/src/app/api/consumer/points-history/route.ts](app/src/app/api/consumer/points-history/route.ts)
  - always filters by authenticated `consumer_id`

- [app/src/app/api/consumer/redemption-history/route.ts](app/src/app/api/consumer/redemption-history/route.ts)
  - always filters by authenticated `user_id`

- [app/src/app/api/consumer/scanned-products/route.ts](app/src/app/api/consumer/scanned-products/route.ts)
  - always filters by authenticated `consumer_id`

### Shop reporting

- [app/src/app/api/admin/shop-points-report/route.ts](app/src/app/api/admin/shop-points-report/route.ts)
  - now aggregates attached users' individual balances instead of reading `v_shop_points_summary`

- [app/src/app/api/admin/shop-consumers/route.ts](app/src/app/api/admin/shop-consumers/route.ts)
  - now shows each attached user's individual wallet balance from `v_consumer_points_balance`

- [app/src/lib/reporting/shop-user-points.ts](app/src/lib/reporting/shop-user-points.ts)
  - pure summary helper for attached-user reporting totals

### UI changes

- [app/src/components/journey/templates/PremiumLoyaltyTemplate.tsx](app/src/components/journey/templates/PremiumLoyaltyTemplate.tsx)
  - insufficient-points modal now trusts the server-provided available balance

- [app/src/components/engagement/catalog/ShopPointsReport.tsx](app/src/components/engagement/catalog/ShopPointsReport.tsx)
  - labels now describe reporting totals as attached-user wallet balances

- [app/src/components/engagement/catalog/ShopCatalogPage.tsx](app/src/components/engagement/catalog/ShopCatalogPage.tsx)
  - pooled shop redemption is disabled
  - catalog messaging no longer claims the shop aggregate is redeemable

## New Consumer Redemption Write Shape

For mobile consumer rewards, new rows are planned with:

- `company_id = null`
- `wallet_scope = 'consumer'`
- `wallet_owner_user_id = authenticated user id`
- `wallet_owner_org_id = null`
- `reporting_shop_id = attached SHOP org id when present`
- `wallet_balance_after = new individual balance`
- `balance_after = new individual balance`
- `wallet_source = 'mobile_consumer_reward'`

Taxonomy note:

- New consumer redemption rows use `point_direction = 'debit'`.
- Older rows and older flows may still contain legacy `point_direction = 'spend'` values.
- Historical cleanup remains separate from this forward fix.

## APIs Changed

### `/api/user/profile`

Still returns `pointsBalance`, now with additional wallet metadata:

- `walletScope`
- `walletOwnerUserId`
- `walletOwnerOrgId`
- `reportingShopId`
- `balanceSource`

### `/api/consumer/redeem-reward`

Success responses now include:

- `new_balance`
- `wallet_scope`
- `wallet_owner_user_id`
- `wallet_owner_org_id`
- `reporting_shop_id`
- `balance_source`

Failure responses for insufficient points now include:

- `current_balance`
- `required`
- wallet metadata matching the consumer wallet resolver

## Tests Added And Run

Added:

- [app/src/lib/utils/qr-resolver.test.ts](app/src/lib/utils/qr-resolver.test.ts)
- [app/src/lib/engagement/consumer-reward-wallet.test.ts](app/src/lib/engagement/consumer-reward-wallet.test.ts)
- [app/src/lib/reporting/shop-user-points.test.ts](app/src/lib/reporting/shop-user-points.test.ts)

Focused test run completed:

- `src/lib/utils/qr-resolver.test.ts`
- `src/lib/engagement/consumer-reward-wallet.test.ts`
- `src/lib/reporting/shop-user-points.test.ts`

Results:

- `3` test files passed
- `5` tests passed

## Historical Cleanup Still Pending

Historical production rows were not mutated in this task.

Follow-up document:

- [docs/issues/2026-05-19-reward-redemption-historical-cleanup-plan.md](docs/issues/2026-05-19-reward-redemption-historical-cleanup-plan.md)

Pending later work:

- annotate historical rows with explicit wallet ownership
- repair reporting attribution for legacy redemptions
- decide whether legacy `point_direction = 'spend'` rows should be normalized

## Production Deployment Checklist

1. Review the migration file manually.
2. Apply the migration before deploying the app code that writes new wallet fields.
3. Verify `redeem_items.wallet_scope` backfill completed as expected.
4. Deploy the app changes.
5. Run read-only verification SQL to confirm new redemptions write:
   - `wallet_scope = 'consumer'`
   - `wallet_owner_user_id` populated
   - `company_id = null`
   - `reporting_shop_id` populated only for reporting
6. Verify a shop-linked `USER` redeems using individual balance.
7. Verify mobile history endpoints return personal rows by `user_id` / `consumer_id`.
8. Verify admin shop report totals follow attached users' balances.
9. Do not run historical cleanup in the same release.