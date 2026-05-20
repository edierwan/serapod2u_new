# Reward Redemption Wallet Scope Investigation

## Executive Summary

This investigation confirms that the `0164481776` incident is not just a single `USER` role-classification bug. The current production system has multiple overlapping wallet interpretations at the same time:

- `v_consumer_points_balance` behaves like an individual user wallet.
- `v_shop_points_balance` behaves like a shop aggregate built from `shop_points_ledger`.
- `shop_points_ledger` can assign a shop to `points_transactions` rows even when the original row had `company_id = null`, by deriving `shop_id` from `consumer_phone` or `consumer_email`.
- `points_transactions` redemption rows often affect both the individual consumer balance and a shop aggregate at the same time.

The incident user failed because the mobile profile/rewards UI used an individual balance while the redeem API used a shop aggregate. But the broader problem is larger: current redemption writes are not consistently aligned to the same wallet that eligibility checks read.

Key production findings from this investigation:

- Current live snapshot for the affected user is now `6090` consumer points vs `-160` shop points. The earlier incident snapshot was `5990` vs `-260`. The balances moved because new scan rows were added after the first assessment, but the scope mismatch still exists.
- Production has `39` redemption rows. All `39` have `user_id`. `27` currently affect both an individual consumer balance and a shop balance.
- `30` redemptions were written with `company_id = null`, but `18` of those still map into `shop_points_ledger` via phone/email fallback.
- `11` shops currently have negative `v_shop_points_balance`. All `11` have redemptions. None have non-zero manual adjustments.
- All `21` current rewards in production are HQ-owned. The schema has no explicit reward wallet scope field.

No code fix was implemented. No production or staging data was modified. No migrations were run. All database access was read-only.

## Incident Summary

Known incident snapshot from the earlier assessment:

- User phone: `0164481776` / `+60164481776`
- User ID: `c2d40146-c034-4e04-96ce-c193dd25e576`
- Name: `Allfan`
- Role: `USER`
- Linked shop: `Brew Beauty`
- Shop ID: `f9bce912-645e-441f-a5cd-291e7806d2a8`
- Reward: `RM500 CASH`
- Reward code: `CASHBACK-CLAIM-DUIT-RM500`
- Reward points required: `5000`
- Consumer balance shown by the mobile UI: `5990`
- Shop aggregate enforced by the redemption API: `-260`

Current live snapshot during this investigation:

- Consumer balance: `6090`
- Shop aggregate: `-160`
- Reason for movement: additional scan rows were added after the initial incident assessment.

The incident mechanism is unchanged:

1. The mobile profile and rewards UI read an individual user balance.
2. The confirm modal calculates the new balance locally from that same individual number.
3. The redeem API treats `role_code = USER` with `organization_id = SHOP` as shop-scoped for eligibility.
4. The API therefore checks the shop aggregate instead of the individual balance.

For the original RM500 incident, the UI saw enough points and allowed the attempt, while the API rejected it because the shop aggregate was negative.

## Current Evidence

### Affected user state

Production user profile:

| Field | Value |
| --- | --- |
| User ID | `c2d40146-c034-4e04-96ce-c193dd25e576` |
| Name | `Allfan` |
| Phone | `+60164481776` |
| Role | `USER` |
| Organization ID | `f9bce912-645e-441f-a5cd-291e7806d2a8` |
| Organization name | `Brew Beauty` |
| Organization type | `SHOP` |

### Current live balances

| Source | Current value | Notes |
| --- | --- | --- |
| `v_consumer_points_balance` | `6090` | Individual user balance used by profile/mobile UI |
| `v_shop_points_balance` | `-160` | Shop aggregate used by redeem eligibility for `USER` + `SHOP` |

### Affected user scan ownership breakdown

Production `consumer_qr_scans` for the affected user currently breaks down as:

| `shop_id` | `claim_lane` | Points | Rows |
| --- | --- | ---: | ---: |
| `null` | `consumer` | `7370` | `737` |
| `f9bce912-645e-441f-a5cd-291e7806d2a8` | `consumer` | `10` | `1` |
| `f9bce912-645e-441f-a5cd-291e7806d2a8` | `shop` | `3100` | `310` |

This is important:

- The user's current consumer balance is mostly built from individual scan rows that are not owned by Brew Beauty.
- The user also has `3100` shop-lane points tied to Brew Beauty.
- The current consumer balance view does not separate those scopes; it sums them together by `consumer_id`.

### Affected user transaction summary

Production `points_transactions` for the affected user currently shows:

| Transaction type | Category | Points | Rows | Notes |
| --- | --- | ---: | ---: | --- |
| `earn` | `bonus` | `30` | `30` | Bonus points |
| `MIGRATION` | `migration` | `5580` | `5` | Legacy migration points |
| `redeem` | `redemption` | `-10000` | `1` | Historical RM1000 cash redemption |

Stored redemption row for the affected user:

| Field | Value |
| --- | --- |
| Transaction ID | `aa4e9563-fec1-4262-a8dd-c0070cb82630` |
| Transaction date | `2026-04-10` |
| Reward | `RM1000 CASH` |
| `points_amount` | `-10000` |
| `balance_after` | `20` |
| `user_id` | `c2d40146-c034-4e04-96ce-c193dd25e576` |
| `company_id` | `null` |
| `consumer_phone` | `+60164481776` |

This row already shows a core design problem:

- `balance_after = 20` is clearly an individual-wallet number.
- The same row is also derived into Brew Beauty's shop ledger through phone matching.
- One row is therefore trying to describe more than one wallet at once.

### Affected shop ledger breakdown

Current Brew Beauty shop ledger breakdown in production:

| Transaction type | Category | Points | Rows |
| --- | --- | ---: | ---: |
| `scan` | `scan` | `4230` | `423` |
| `MIGRATION` | `migration` | `5580` | `5` |
| `earn` | `bonus` | `30` | `30` |
| `redeem` | `redemption` | `-10000` | `1` |

Net result:

$$4230 + 5580 + 30 - 10000 = -160$$

Shop contributor summary for Brew Beauty:

| `consumer_id` | Name | Points contribution | Rows |
| --- | --- | ---: | ---: |
| `null` | anonymous / no linked consumer | `1120` | `112` |
| `c2d40146-c034-4e04-96ce-c193dd25e576` | Allfan | `-1280` | `347` |

This means Brew Beauty's aggregate is not just Allfan's wallet. It is already a pooled or reporting aggregate across at least:

- shop-linked rows for Allfan
- anonymous or unlinked shop rows with `consumer_id = null`

### Why the UI says redeem is allowed but the API rejects

Current mobile flow:

1. `PremiumLoyaltyTemplate` loads `userPoints` from `/api/user/profile`.
2. `/api/user/profile` calls `resolveTrustedPointsBalance(...)`.
3. `resolveTrustedPointsBalance(...)` treats `USER` as consumer-scoped.
4. The UI therefore sees the individual's `v_consumer_points_balance`.

Current redeem API flow:

1. `/api/consumer/redeem-reward` checks `isConsumerRole = ['GUEST', 'CONSUMER'].includes(role_code)`.
2. `USER` is not included in that local list.
3. A `USER` linked to a `SHOP` falls through to `v_shop_points_balance`.
4. The API checks the shop aggregate instead of the personal balance.

So the same account is presented with one wallet in the UI and a different wallet in the API.

## Current Data Model

### Core tables, views, and functions

| Object | Type | Purpose | Key columns | Owner key used | Individual / aggregate | Source-of-truth or reporting |
| --- | --- | --- | --- | --- | --- | --- |
| `consumer_qr_scans` | table | Source rows for QR collections and manual adjustments | `consumer_id`, `shop_id`, `points_amount`, `claim_lane`, `is_manual_adjustment`, `adjustment_type`, `points_collected_at` | `consumer_id`, `shop_id` | Row-level event that can feed both individual and shop aggregates | Source-of-truth for scan/manual-adjust rows |
| `points_transactions` | table | Ledger for migration, bonus, redemption, adjust, registration, roadtour, other non-scan point rows | `user_id`, `company_id`, `consumer_phone`, `consumer_email`, `transaction_type`, `points_amount`, `balance_after`, `redeem_item_id`, `point_category`, `point_direction` | `user_id`, `company_id`, phone/email fallback downstream | Ambiguous today; same row can affect multiple downstream wallets | Source-of-truth for non-scan transaction rows |
| `shop_points_ledger` | live production view | Unified ledger over `consumer_qr_scans` and `points_transactions` | `shop_id`, `consumer_id`, `points_change`, `transaction_type`, `claim_lane`, `redeem_item_id`, `reward_name` | `shop_id` from `consumer_qr_scans.shop_id`, `points_transactions.company_id`, or derived from phone/email lookup | Aggregate / derived ledger | Reporting view, but currently used as a wallet source |
| `v_consumer_points_balance` | live production view | Individual balance summary per user | `user_id`, `current_balance`, `total_collected_system`, `total_collected_manual`, `total_migration`, `total_redeemed`, `total_other`, `transaction_count` | `user_id` | Individual | Reporting view, but currently used as a wallet source |
| `v_shop_points_balance` | view | Shop-level aggregate over `shop_points_ledger` | `shop_id`, `current_balance`, `transaction_count`, `total_earned_scans`, `total_manual_adjustments`, `total_redeemed` | `shop_id` | Aggregate | Reporting view, but currently used as a wallet source |
| `v_shop_points_summary` | view | Shop performance reporting summary for admin pages | `shop_id`, `total_points_balance`, other summary fields | `shop_id` | Aggregate | Reporting view |
| `v_admin_redemptions` | view | HQ/admin redemption reporting | `id`, `shop_id`, `company_id`, `reward_id`, `staff_user_id`, `points_amount`, `balance_after`, `reward_name` | `shop_id` from `points_transactions.company_id`; `company_id` from `redeem_items.company_id` | Mixed reporting view | Reporting view |
| `redeem_items` | table | Reward catalog | `company_id`, `item_code`, `item_name`, `category`, `points_required`, `point_offer`, `point_reward_amount`, `collection_mode`, `per_user_limit`, `is_active` | `company_id` | Reward ownership only; no wallet scope | Source-of-truth catalog |
| `can_consumer_redeem_gift(...)` | function | Separate free-gift eligibility path | gift id, consumer phone | consumer phone | Individual gift redemption, not points wallet | Separate function path |
| `consumer_collect_points(...)` | function / RPC | Writes QR claim rows into `consumer_qr_scans` and updates QR flags | raw QR code, user id, claim lane, points amount | `consumer_id`, derived `shop_id` | Row-level event source | Source-of-truth write function |
| `resolveTrustedPointsBalance(...)` | application function | Shared application resolver for profile and point collection | `userId`, `roleCode`, `organizationId` | user or organization depending role | Either | Application abstraction, not DB source |

### Live production view behavior that matters

The live production definitions are more important than comments or stale assumptions in the repo.

Key behaviors confirmed from `pg_get_viewdef(...)` on production:

1. `shop_points_ledger` derives `shop_id` for transaction rows using:

```sql
COALESCE(
  pt.company_id,
  (
    SELECT u.organization_id
    FROM users u
    JOIN organizations org ON org.id = u.organization_id
    WHERE (u.phone = pt.consumer_phone OR u.email = pt.consumer_email)
      AND org.org_type_code = ANY (ARRAY['SHOP', 'INDEP'])
    LIMIT 1
  )
)
```

2. Live production `v_consumer_points_balance` no longer excludes `SHOP` users by organization type. It includes any user with qualifying scan or transaction rows.

3. `v_shop_points_balance` is a pure group-by over `shop_points_ledger`, so any mis-assigned `shop_id` immediately changes the shop wallet/report.

### Repo snapshot drift vs live production

The checked-in snapshot and comments are not fully aligned with live production:

- `supabase/schemas/current_schema.sql` still shows an older `v_consumer_points_balance` definition with an organization-type exclusion for `SHOP`.
- `app/src/app/api/admin/shop-consumers/route.ts` contains a comment saying `SHOP` users are intentionally excluded from `v_consumer_points_balance`.
- Live production `pg_get_viewdef('v_consumer_points_balance')` does not contain that `SHOP` exclusion.

This matters because local assumptions about who appears in the consumer balance view are currently wrong for production.

## Current Code Path Map

### Balance read paths

| File path | Function / route / component | Feature | Balance source | Role logic | `USER` handling | Mismatch risk |
| --- | --- | --- | --- | --- | --- | --- |
| `app/src/lib/utils/qr-resolver.ts` | `resolveTrustedPointsBalance` | Core balance abstraction | `v_consumer_points_balance`, `v_shop_points_balance`, fallbacks to `shop_points_ledger` / `consumer_qr_scans` | `GUEST`, `CONSUMER`, `USER` treated as consumer-scoped | consumer-scoped | High |
| `app/src/app/api/user/profile/route.ts` | `GET /api/user/profile` | Mobile profile | `resolveTrustedPointsBalance(...)` | inherits resolver | consumer-scoped | High if other routes do not use same resolver |
| `app/src/components/journey/templates/PremiumLoyaltyTemplate.tsx` | `checkUserOrganization()` and `userPoints` state | Mobile rewards UI | `pointsBalance` from `/api/user/profile` | none in component; trusts API | consumer-scoped because profile API is | High |
| `app/src/app/api/consumer/redeem-reward/route.ts` | `POST /api/consumer/redeem-reward` | Reward eligibility | `v_consumer_points_balance` or `v_shop_points_balance` | `['GUEST', 'CONSUMER']` are consumer; all other shop-linked roles use shop aggregate | shop-scoped if linked to SHOP | Critical |
| `app/src/app/api/consumer/points-history/route.ts` | `GET /api/consumer/points-history` | Points history tab | `shop_points_ledger` | only `GUEST` / `CONSUMER` use `consumer_id`; other shop-linked users use `shop_id` | shop-scoped history | High |
| `app/src/app/api/consumer/redemption-history/route.ts` | `GET /api/consumer/redemption-history` | Redemption history tab | `points_transactions` filtered by `company_id` or `user_id` | any user with `organization_id` gets shop filter; no `role_code` check | shop-scoped history for linked users | High |
| `app/src/app/api/consumer/scanned-products/route.ts` | `GET /api/consumer/scanned-products` | Rewards tab scanned-products history | `shop_points_ledger` | if linked to shop, filter by `shop_id`; otherwise by `consumer_id` | shop-scoped if linked | High |
| `app/src/app/api/consumer/check-collection-status/route.ts` | `GET /api/consumer/check-collection-status` | QR pre-check | `resolveTrustedPointsBalance(...)` or `calculateShopTotalPoints(...)` | resolver-based | consumer-scoped when `consumer_id` exists | Medium |
| `app/src/app/api/consumer/collect-points/route.ts` | `POST /api/consumer/collect-points` | QR collect flow | `resolveTrustedPointsBalance(...)` before and after collect | resolver-based | consumer-scoped | Medium |
| `app/src/app/api/consumer/collect-points-auth/route.ts` | `POST /api/consumer/collect-points-auth` | Authenticated collect flow | `resolveTrustedPointsBalance(...)` before and after collect | resolver-based | consumer-scoped | Medium |
| `app/src/app/api/consumer/rewards/route.ts` | `GET /api/consumer/rewards` | Reward catalog fetch | no balance read; fetches rewards only | none | none | Medium because reward scope is not returned |
| `app/src/components/engagement/catalog/ShopCatalogPage.tsx` | shop catalog loader | Shop portal rewards and ledger page | `v_shop_points_balance`, `shop_points_ledger` | shop portal only | not applicable | Medium |
| `app/src/components/engagement/catalog/AdminCatalogPage.tsx` | `loadShopUsers()` | Admin shop monitor | `v_shop_points_balance` | admin scope | not applicable | Medium |
| `app/src/app/api/admin/consumer-performance/route.ts` | `GET /api/admin/consumer-performance` | Admin consumer monitor | `v_consumer_points_balance` filtered by `claim_lane = consumer` and excluding scoped shop users | admin only | USER shop-linked users excluded by membership logic, not by view | Medium |
| `app/src/app/api/admin/shop-staff-performance/route.ts` | `GET /api/admin/shop-staff-performance` | Admin staff monitor | manual aggregation from `consumer_qr_scans` + `points_transactions` | admin only | USER shop-linked users appear as personal balances | High |
| `app/src/app/api/admin/shop-points-report/route.ts` | `GET /api/admin/shop-points-report` | Admin shop report | `v_shop_points_summary` plus `shop_points_ledger` bonus sums | admin only | not applicable | Medium |
| `app/src/app/api/admin/redemptions/route.ts` | `GET /api/admin/redemptions` | Admin redemption management | `points_transactions` with `company_id` shop filter | HQ / manufacturer admin only | not applicable | Medium |
| `app/src/app/api/admin/redemption-history/route.ts` | `GET /api/admin/redemption-history` | HQ redemption history page | `v_admin_redemptions` filtered by `company_id` | admin org only | not applicable | High because `company_id` here is reward owner, not wallet owner |
| `app/src/app/api/message-setup/preview/route.ts` | preview token resolution | WhatsApp token preview | `v_consumer_points_balance` | none | always consumer balance | Low |
| `app/src/app/api/wa/marketing/test-send/route.ts` | test send token resolution | WhatsApp test send | `v_consumer_points_balance` | none | always consumer balance | Low |
| `app/src/app/api/wa/marketing/campaigns/[id]/launch/route.ts` | launch message personalization | WhatsApp launch token resolution | `v_consumer_points_balance` | none | always consumer balance | Low |
| `app/src/app/api/agent/assist/route.ts` | AI support context | Legacy agent assist | `consumer_points` legacy view/table | none | legacy | High / stale |
| `app/src/app/api/agent/points/route.ts` | AI agent points endpoint | Legacy agent balance endpoint | `consumer_points` or direct `points_transactions` fallback | none | legacy | High / stale |

### Code-path contradictions that matter

1. The profile/mobile path uses the shared resolver. The redeem route does not.
2. `points-history`, `redemption-history`, and `scanned-products` all treat shop-linked users differently from the mobile profile balance.
3. Shop monitoring pages show personal staff balances, while shop rewards pages use pooled shop balances.
4. Marketing and message preview paths always use `v_consumer_points_balance`, so tokenized `points_balance` messaging is individual even when reward redemption or history routes are shop-scoped.

## Role and Organization Matrix

### Current production and staging role usage

| Role code | Prod count | Staging count | Has organization_id? | Org types found | Currently treated as consumer-scoped where? | Currently treated as shop-scoped where? | Should require product decision? |
| --- | ---: | ---: | --- | --- | --- | --- | --- |
| `GUEST` | `1771` | `1664` | Mixed; prod `150` with org, staging `73` with org | `(none)`, `SHOP` | `resolveTrustedPointsBalance`, `/api/user/profile`, `/api/consumer/redeem-reward`, `/api/consumer/points-history` | `/api/consumer/redemption-history` if linked to a shop because it filters by `company_id` whenever `organization_id` exists | Yes |
| `CONSUMER` | `0` | `0` | none in current data | none | Code branches still treat it as consumer-scoped | none in live data | Yes, because code assumes it exists |
| `USER` | `5` | `5` | prod `5` with org, staging `4` with org | prod `HQ`, `SHOP`, `WH`; staging `(none)`, `HQ`, `WH` | `resolveTrustedPointsBalance`, `/api/user/profile`, live `v_consumer_points_balance`, admin shop-consumer listing | `/api/consumer/redeem-reward`, `/api/consumer/points-history`, any organization-linked `/api/consumer/redemption-history` | Yes, especially `USER` + `SHOP` |
| `HQ` | `15` | `15` | all | `HQ`, `MFG`, `WH` | no | admin only | No immediate wallet decision |
| `POWER_USER` | `7` | `7` | all | `HQ` | no | admin only | No immediate wallet decision |
| `SA` | `2` | `3` | all | `HQ` | no | admin only | No immediate wallet decision |
| `MANAGER` | `7` | `7` | mixed | `(none)`, `HQ` | no | not in wallet flows | Low |
| `SHOP` | `0` prod, `1` staging | `1` staging only | yes | `SHOP` | no | unclear; not used in investigated reward code | Yes if this role will ever redeem |

### Specific `USER + SHOP` drift finding

Production:

- `USER` + `SHOP` accounts: `1`
- `USER` + `SHOP` with positive consumer balance: `1`
- `USER` + `SHOP` with consumer balance different from shop balance: `1`

That one production account is the affected user (`Allfan`).

Staging:

- `USER` + `SHOP` accounts: `0`

This means the current staging dataset does not contain a direct equivalent of the production incident, even if the code and views are similar.

## Ledger Write/Deduction Map

| File path | Write path | Table written | Owner keys written | Balance checked before write | Which wallet(s) the row actually affects | Mismatch risk |
| --- | --- | --- | --- | --- | --- | --- |
| `app/src/app/api/consumer/redeem-reward/route.ts` | consumer/mobile redemption | `points_transactions` | always `user_id`; `company_id = shopId` for any linked shop user; `company_id = null` only if independent | `v_consumer_points_balance` for `GUEST` / `CONSUMER` or independent; `v_shop_points_balance` for other shop-linked roles | `v_consumer_points_balance` always when `user_id` exists; `shop_points_ledger` and `v_shop_points_balance` when `company_id` exists; historical rows can still hit shop via phone/email fallback even with `company_id = null` | Critical |
| `app/src/components/engagement/catalog/ShopCatalogPage.tsx` | shop portal redemption | `points_transactions` | `company_id = shopOrgId`; no `user_id` | `v_shop_points_balance` | Shop ledger / shop balance only | Medium |
| `app/src/components/engagement/catalog/AdminCatalogPage.tsx` | admin manual subtract / add | `consumer_qr_scans` primary audit row, plus `points_transactions` backward-compat row | `consumer_qr_scans`: `consumer_id` or `shop_id`; `points_transactions`: `user_id` only for consumer adjustments, `company_id = admin companyId` | selected user's current balance in UI state | Consumer view, shop view, or both depending target; backward-compat transaction row can use an owner different from the primary scan adjustment row | High |
| `app/src/app/api/admin/point-migration/route.ts` | migration import | `points_transactions` | `user_id`; `company_id = null` | `v_consumer_points_balance` | Consumer balance only | Medium |
| `app/src/app/api/admin/point-migration-stream/route.ts` | streaming migration import | `points_transactions` | `user_id`; `company_id = null` | prefetched `v_consumer_points_balance` | Consumer balance only | Medium |

### Critical answers to the deduction questions

#### If redemption eligibility checks consumer balance, does the actual deduction also deduct consumer ledger?

Yes.

- The row always has `user_id` in `/api/consumer/redeem-reward`.
- Live `v_consumer_points_balance` sums `points_transactions` by `user_id`.

#### If redemption eligibility checks consumer balance, does the actual deduction also deduct shop ledger?

Often yes.

- Current code writes `company_id = shopId` for any linked shop user, even when the eligibility check used consumer balance.
- Historical rows with `company_id = null` can still map into `shop_points_ledger` through phone/email fallback.

#### If redemption eligibility checks shop balance, does the actual deduction deduct shop ledger?

Yes.

- The row either has `company_id = shopId` directly, or the live `shop_points_ledger` can derive `shop_id` from phone/email.

#### If redemption eligibility checks shop balance, does the actual deduction also deduct consumer ledger?

Yes when `user_id` is present.

- Current `/api/consumer/redeem-reward` always writes `user_id`.
- So even a shop-scoped eligibility check still produces a consumer-balance deduction row.

This means the current redeem flow does not guarantee that the write target matches the eligibility source. In many cases it deducts both.

## Historical Data Risk

### Production redemption pattern summary

| Metric | Count |
| --- | ---: |
| Total redemption rows | `39` |
| Redemption rows with `user_id` | `39` |
| Redemption rows with `company_id` | `9` |
| Redemption rows with both `user_id` and `company_id` | `9` |
| Redemption rows with `user_id` and `company_id = null` | `30` |
| Redemption rows affecting consumer view | `39` |
| Redemption rows affecting both consumer and shop | `27` |
| Redemption rows affecting consumer only | `12` |
| Redemption rows affecting shop only | `0` |

### Derived shop pollution

Of the `30` redemptions written with `company_id = null`:

- `18` still map into `shop_points_ledger` using phone/email-derived shop lookup
- `12` remain consumer-only
- `13` of those `18` derived-shop rows currently feed shops that are negative

Sample derived-shop rows include:

- `aa4e9563-fec1-4262-a8dd-c0070cb82630` -> Allfan -> derived to Brew Beauty -> `RM1000 CASH`
- `eda78630-2d26-460b-acae-b91394ef9ee2` -> derived to Curry Puaka Vape -> `RM500 CASH`
- `49be7223-059b-4379-b77a-9ed7e253ac35` -> derived to Kami Studio -> `RM500 CASH`
- `ef91641a-cc7d-4eb6-806b-6ac92817271e` -> derived to Yan Vape Zone -> `RM500 CASH`

### Admin reporting blind spot

`18` production redemptions currently have this pattern:

- `shop_points_ledger` derives a non-null `shop_id`
- `v_admin_redemptions.shop_id` remains `null`

Reason:

- `shop_points_ledger.shop_id` can be derived from phone/email
- `v_admin_redemptions.shop_id` comes only from `points_transactions.company_id`

So the same redemption can affect a shop aggregate while HQ/admin redemption history loses the actual shop linkage.

### Negative shop balances

Production currently has:

- `11` shops with negative `v_shop_points_balance`
- `11` of `11` have redemptions
- `0` of `11` have non-zero manual adjustments
- `19` redemption rows currently feed those negative shops through `shop_points_ledger`

This indicates the negative balances are driven by redemption behavior, not manual adjustment activity.

### Is later data cleanup likely required?

Yes, if wallet ownership is normalized later.

Reason:

- Current production redemptions are not consistently single-owner rows.
- Historical rows already affect the wrong shop aggregates via explicit `company_id` or derived shop lookup.
- History/reporting APIs disagree about which shop, if any, owns a redemption.

This is not only a forward code bug. Historical cleanup will likely be needed after the product decides the intended wallet model.

## Reward Scope Analysis

### Current reward schema

Production `redeem_items` has these relevant fields:

- `company_id`
- `points_required`
- `max_redemptions_per_consumer`
- `is_active`
- `point_offer`
- `category`
- `point_reward_amount`
- `collection_mode`
- `per_user_limit`

Production does not have any explicit field such as:

- `wallet_scope`
- `audience`
- `redeemable_by`
- `user_type`
- `organization_type`
- `is_shop_reward`
- `is_consumer_reward`
- reward metadata for wallet owner

### RM500 CASH definition

Production `RM500 CASH` row:

| Field | Value |
| --- | --- |
| Reward ID | `cdb40c02-65b5-4517-b2f6-9838b28c76ee` |
| Item code | `CASHBACK-CLAIM-DUIT-RM500` |
| Item name | `RM500 CASH` |
| Category | `other` |
| `points_required` | `5000` |
| `point_offer` | `null` |
| `point_reward_amount` | `null` |
| `collection_mode` | `always` |
| `per_user_limit` | `false` |
| `company_id` | `e08f8574-e787-482b-b9fc-2b1551720056` |
| Reward owner org | `Serapod Technology Sdn Bhd` |
| Reward owner org type | `HQ` |

### Current reward ownership pattern

Production reward ownership summary:

| Reward owner org type | Reward count | Categories |
| --- | ---: | --- |
| `HQ` | `21` | `merch`, `other`, `point` |

There are currently no production rewards owned by a `SHOP` organization.

### Interpretation

Current evidence shows:

- Rewards are HQ-owned.
- Rewards do not declare whether redemption should use a consumer wallet or a shop wallet.
- The same `redeem_items` table is used by both the mobile consumer UI and the shop portal UI.

So the missing reward scope is part of the root design issue.

## API Contract Analysis

| API / route | Input identity used | Balance returned or checked | Ledger written or history filtered | Scope exposed to client? | Main contract problem |
| --- | --- | --- | --- | --- | --- |
| `/api/user/profile` | authenticated user | returns `pointsBalance` from `resolveTrustedPointsBalance(...)` | none | No `wallet_scope`, `owner_type`, or source metadata | Client sees a number but not which wallet it belongs to |
| `/api/consumer/rewards` | `org_id` | no balance returned | none | No | Reward list has no wallet scope |
| `/api/consumer/redeem-reward` | authenticated user | checks `v_consumer_points_balance` or `v_shop_points_balance` using local role logic | writes `points_transactions` with `user_id` and often `company_id` | No; returns `new_balance` only | Check source and write target are not guaranteed to match |
| `/api/consumer/redemption-history` | authenticated user | no balance | filters by `company_id` if linked to org, else by `user_id` | No | Shop-linked users do not necessarily see their own personal redemption rows |
| `/api/consumer/points-history` | authenticated user | no single balance field; returns ledger rows | filters `shop_points_ledger` by `shop_id` or `consumer_id` | No | `USER` linked to shop sees shop history, not personal history |
| `/api/consumer/scanned-products` | authenticated user | no single balance field; returns scan aggregates | filters `shop_points_ledger` by `shop_id` or `consumer_id` | No | Same scope split as points history |
| `/api/admin/redemptions` | admin user | no balance | reads `points_transactions` filtered by `company_id` shop | No | Uses transaction `company_id` as shop owner |
| `/api/admin/redemption-history` | admin user | no balance | reads `v_admin_redemptions` filtered by reward `company_id` | No | `company_id` means reward owner HQ here, not shop wallet owner |
| `/api/admin/consumer-performance` | admin user | returns `current_balance` from `v_consumer_points_balance` | none | No | Personal balances are shown without explaining lane or org scope |
| `/api/admin/shop-staff-performance` | admin user | computes `current_balance` manually from scans + transactions | none | No | Manual aggregation differs from resolver/view logic |
| `/api/admin/shop-points-report` | admin user | returns shop summary aggregate | none | No | Reporting view name suggests summary, but other flows use shop balance as wallet |
| Point migration APIs | admin user + import file | reads `v_consumer_points_balance` | writes `points_transactions` with `company_id = null` | No | Migration is clearly individual-scoped; mixed with shop aggregation downstream |

### Additional contract ambiguity

The term `company_id` is overloaded across objects:

- In `points_transactions`, routes use it as a shop wallet owner or leave it `null`.
- In `redeem_items`, it means reward catalog owner, which is currently HQ.
- In `v_admin_redemptions`, the `company_id` column comes from the reward row, while `shop_id` comes from the transaction row.

This makes admin history, reporting, and wallet ownership harder to reason about.

## Mobile UX Analysis

### Where `userPoints` comes from

In `PremiumLoyaltyTemplate`:

- `checkUserOrganization()` calls `/api/user/profile`
- the component stores `profile.pointsBalance` into `userPoints`

So the mobile rewards UI depends on the same profile resolver result everywhere.

### Current behavior in the rewards flow

1. Rewards are fetched from `/api/consumer/rewards`.
2. The rewards list itself does not carry any wallet scope metadata.
3. The client checks `if (userPoints < pointsNeeded)` before opening the confirm flow.
4. The confirm modal shows:

```ts
New Balance = userPoints - (selectedReward.point_offer || selectedReward.points_required)
```

5. The client calls `/api/consumer/redeem-reward`.
6. On success it trusts `data.new_balance` and refreshes rewards + history.
7. On failure it shows `data.error`, but it does not switch the UI into a server-authoritative balance state.

### UX consequences

- The mobile UI calculates eligibility locally from the individual profile balance.
- The confirm modal calculates new balance locally from the same number.
- The insufficient-points animation also uses the local `userPoints`, not the server's checked scope.
- The API response does not expose `wallet_scope`, `owner_id`, or `balance_source`, so the client cannot explain a scope mismatch even if it wanted to.

### History tab mismatches for shop-linked users

For a shop-linked `USER` like Allfan:

- `userPoints` uses the individual consumer balance.
- `points-history` uses shop history because `USER` is not considered a consumer role there.
- `redemption-history` filters by `company_id = shopId`, so Allfan's own historical redemption row with `company_id = null` is currently invisible in that tab.

Confirmed from production data:

- Redemptions visible to the current `redemption-history` route for Brew Beauty: `0`
- Direct redemption rows for Allfan by `user_id`: `1`

So the history tabs can already disagree with both the profile balance and the actual stored redemption rows.

### Later UX hardening that will be needed

- Show the same wallet scope the server will use.
- Stop doing local final-balance math without server scope confirmation.
- Show server-reported current balance and wallet owner on rejection.
- Label history tabs clearly if they are shop history versus personal history.

## Product Decision Questions

The product owner needs to answer these before a safe fix is implemented:

1. Are mobile rewards always individual user rewards?
2. Can shop staff redeem using their own points?
3. Can a shop owner redeem pooled shop points?
4. Should shop aggregate balance be redeemable or reporting-only?
5. Should `USER` linked to `SHOP` always be consumer-scoped?
6. Should reward definitions declare `wallet_scope` explicitly?
7. Should existing negative shop balances be corrected later?
8. Should historical redemptions be migrated if they were written to the wrong ledger?
9. Should one redemption ever reduce both an individual wallet and a shop aggregate at the same time?
10. Should `shop_points_ledger` be allowed to derive shop ownership from phone/email for redemptions?
11. Should `points_transactions.company_id` always mean wallet owner, while reward owner gets a separate field?
12. Should shop-linked users see personal history, shop history, or both in the mobile UI?

## Wallet Model Options

### Option A: Individual user wallet only for mobile rewards

Definition:

- Staff/user points belong to each user.
- Shop total is reporting aggregate only.
- User A cannot redeem User B or the shop's pooled points.
- Mobile reward redemption always checks and deducts the individual user wallet.

Pros:

- Best match for the current mobile UI and personal bank/address flow.
- Best match for current `userPoints`, profile, and personal bonus/migration behavior.
- Simplest mental model for mobile users.

Cons:

- Conflicts with the current `ShopCatalogPage` that redeems from `v_shop_points_balance`.
- Makes the current shop portal redemption flow invalid unless that flow is removed or reworked.
- Requires reporting pages to stop implying that shop aggregate is redeemable.

Required code/data changes later:

- Consumer/mobile reward redemptions must write only the individual wallet owner.
- `shop_points_ledger` must stop deriving shop ownership for individual reward redemptions.
- Shop histories must be separated from personal histories.
- Historical shop pollution from individual redemptions likely needs cleanup.

### Option B: Shop pooled wallet

Definition:

- All attached staff/user points contribute to a pooled shop wallet.
- Authorized shop accounts redeem from the pooled shop wallet.
- Individual users may collect, but redemption authority belongs to the shop context.

Pros:

- Best match for `ShopCatalogPage` and current use of `v_shop_points_balance` as a redeem source.
- Supports a pooled loyalty program for shop branches.

Cons:

- Conflicts with current mobile UX, which looks personal at every step.
- Conflicts with personal bank and address checks in the mobile redemption flow.
- Makes user-specific migration, bonus, and points history semantics harder to explain.
- Introduces authorization questions: which staff can spend pooled points?

Required role/permission changes later:

- Explicit shop owner / authorized redeemer permissions.
- Separate shop login state or wallet owner selection.
- Clear shop-level history and approval flow.

Main risk:

- Cross-user point spending without explicit consent or visibility.

### Option C: Hybrid model

Definition:

- Consumer rewards use an individual wallet.
- Shop rewards use an explicit shop wallet.
- Reward definition must specify wallet scope.
- Resolver returns both balance and wallet ownership metadata.

Pros:

- Best fit for the current product surfaces because both personal and shop flows already exist.
- Preserves the mobile personal rewards experience.
- Preserves the shop-portal use case if the business still wants it.
- Gives reporting pages a clear distinction between redeemable wallets and aggregates.

Cons:

- Requires schema and API changes.
- Requires reward-scope backfill for existing rewards.
- Requires a cleanup plan for historical mixed-scope rows.

Required changes later:

- Add explicit `wallet_scope` to rewards and redemption records.
- Add a shared resolver that returns both balance and wallet owner.
- Make all redemption writes target one explicit owner only.
- Separate reporting aggregates from redeemable wallets.

Best long-term recommendation:

- Yes. This is the safest long-term model based on current code and UI evidence.

## Recommended Direction

Recommend **Option C: Hybrid model**, with this operational default until schema changes are introduced:

1. Treat the current mobile rewards experience as an individual consumer wallet flow.
2. Treat current shop aggregates as reporting views unless a reward is explicitly marked shop-scoped later.
3. Do not let one redemption row affect both individual and shop balances.
4. Add explicit wallet ownership to rewards, redemptions, and resolver responses.
5. Keep `shop_points_ledger` for reporting if needed, but stop using derived shop ownership for consumer redemptions.

Why this is the best fit:

- The current mobile UX is personal, not pooled.
- The current reward catalog is HQ-owned and scope-less.
- The current shop portal already exists and may still be a valid shop use case.
- The current data already proves that mixed-scope rows create negative shops, invisible history, and inconsistent balances.

## Proposed Fix Plan for Later

### Phase 1: unify resolver

- Create one shared wallet resolver used by profile, redeem eligibility, history, reporting adapters, and UI.
- Resolver should return:
  - `balance`
  - `wallet_scope`
  - `owner_type`
  - `owner_id`
  - `balance_source`
  - `ledger_source`
  - `role_classification_reason`

### Phase 2: align redeem check + deduct

- Use the same resolver result for:
  - eligibility check
  - deduction target
  - redemption record owner
  - `balance_after`
  - logs and history responses

### Phase 3: add reward scope if needed

- Add explicit reward wallet scope such as `consumer` or `shop`.
- Backfill existing rewards after product decides the intended model.

### Phase 4: harden UI

- Show wallet scope in the mobile client.
- Stop local-only final-balance math when scope is ambiguous.
- Show server balance/source on insufficient-points errors.
- Label personal vs shop histories clearly.

### Phase 5: regression tests

- Add automated tests for all scoped combinations and history responses.

### Phase 6: optional historical data cleanup

- After the product decision, repair or annotate historical rows that hit the wrong ledger or lost shop linkage.

## Regression Tests To Add Later

1. Shop-linked `USER` should get the same wallet scope in profile, redeem eligibility, and mobile UI.
2. Shop-linked `GUEST` redeeming a consumer-scoped reward should only affect the individual wallet.
3. Shop-scoped rewards, if supported later, should only affect the explicit shop wallet.
4. A redemption row must never affect both consumer and shop balances unless a dual-impact design is explicitly approved.
5. `balance_after` must be validated against the resolved wallet owner.
6. `points-history`, `redemption-history`, and profile balance must agree on wallet scope.
7. `shop_points_ledger` must not derive shop ownership for consumer-scoped redemptions if the chosen model forbids it.
8. Historical rows with `company_id = null` but derived `shop_id` should be covered in migration or compatibility tests.
9. `v_admin_redemptions` and admin history endpoints should preserve the correct shop linkage if shop scope is intended.
10. Staging fixtures should include at least one `USER + SHOP` account so this class of bug is testable before release.

## Files Inspected

- `app/src/lib/utils/qr-resolver.ts`
- `app/src/app/api/user/profile/route.ts`
- `app/src/app/api/consumer/redeem-reward/route.ts`
- `app/src/app/api/consumer/rewards/route.ts`
- `app/src/app/api/consumer/redemption-history/route.ts`
- `app/src/app/api/consumer/points-history/route.ts`
- `app/src/app/api/consumer/scanned-products/route.ts`
- `app/src/app/api/consumer/check-collection-status/route.ts`
- `app/src/app/api/consumer/collect-points/route.ts`
- `app/src/app/api/consumer/collect-points-auth/route.ts`
- `app/src/components/journey/templates/PremiumLoyaltyTemplate.tsx`
- `app/src/components/engagement/catalog/ShopCatalogPage.tsx`
- `app/src/components/engagement/catalog/AdminCatalogPage.tsx`
- `app/src/components/engagement/catalog/UserPointsMonitor.tsx`
- `app/src/app/api/admin/consumer-performance/route.ts`
- `app/src/app/api/admin/shop-staff-performance/route.ts`
- `app/src/app/api/admin/shop-points-report/route.ts`
- `app/src/app/api/admin/redemptions/route.ts`
- `app/src/app/api/admin/redemption-history/route.ts`
- `app/src/app/api/admin/shop-consumers/route.ts`
- `app/src/app/api/admin/_user-management-scope.ts`
- `app/src/app/api/message-setup/preview/route.ts`
- `app/src/app/api/wa/marketing/campaigns/[id]/launch/route.ts`
- `app/src/app/api/wa/marketing/test-send/route.ts`
- `app/src/app/api/agent/assist/route.ts`
- `app/src/app/api/agent/points/route.ts`
- `app/src/app/api/bot/resolve-user/route.ts`
- `app/src/lib/actions.ts`
- `app/src/app/api/admin/point-migration/route.ts`
- `app/src/app/api/admin/point-migration-stream/route.ts`
- `app/src/app/api/scratch-card/claim/route.ts`
- `app/src/types/shop-points.ts`
- `supabase/schemas/current_schema.sql`
- `supabase/migrations/20260410_user_registration_bonus_and_roadtour_defaults.sql`
- `supabase/migrations/20260412_dual_claim_and_taxonomy_phase2.sql`

## Queries/Commands Used

All database access was read-only. Secrets were not echoed.

Representative command template used:

```sh
ssh -i ~/.ssh/id_ed25519 deploy@72.62.253.182 \
  "source /srv/apps/supabase-production/.env >/dev/null 2>&1 && \
   psql -h 127.0.0.1 -p 6544 -U supabase_admin -d supabase -c '<read-only SQL>'"
```

Representative staging template used:

```sh
ssh -i ~/.ssh/id_ed25519 deploy@72.62.253.182 \
  "source /srv/apps/supabase-staging/.env >/dev/null 2>&1 && \
   psql -h 127.0.0.1 -p 6543 -U supabase_admin -d supabase -c '<read-only SQL>'"
```

Read-only query categories executed:

1. Role matrix in production and staging from `users` joined to `organizations`.
2. `USER + SHOP` balance-drift joins across `users`, `v_consumer_points_balance`, and `v_shop_points_balance`.
3. Reward schema inspection from `information_schema.columns` and `redeem_items`.
4. Reward owner inspection for `RM500 CASH` and reward ownership counts by org type.
5. Production redemption ownership patterns from `points_transactions`.
6. Production negative shop balance summaries from `v_shop_points_balance`.
7. Affected user profile, consumer balance, shop balance, scan ownership, and transaction summaries.
8. Affected shop contributor summary from `shop_points_ledger`.
9. Derived shop pollution counts by joining `points_transactions` to `shop_points_ledger`.
10. Admin-history linkage checks via `v_admin_redemptions`.
11. Live production `pg_get_viewdef(...)` for `shop_points_ledger`, `v_consumer_points_balance`, and `v_shop_points_balance`.

## Appendix

### Appendix A: Live production view behavior that drives the bug

`shop_points_ledger` transaction-side shop derivation:

```sql
COALESCE(
  pt.company_id,
  (
    SELECT u.organization_id
    FROM users u
    JOIN organizations org ON org.id = u.organization_id
    WHERE (u.phone = pt.consumer_phone OR u.email = pt.consumer_email)
      AND org.org_type_code = ANY (ARRAY['SHOP', 'INDEP'])
    LIMIT 1
  )
) AS shop_id
```

Implication: a redemption row with `company_id = null` can still alter shop balance.

### Appendix B: Current mobile client math

From `PremiumLoyaltyTemplate` confirm modal:

```ts
if (userPoints < pointsNeeded) {
  setInsufficientPointsData({ needed: pointsNeeded, available: userPoints })
}

New Balance = userPoints - (selectedReward.point_offer || selectedReward.points_required)
```

Implication: the mobile client trusts the profile balance and does local math before the server resolves wallet scope.

### Appendix C: Current redeem write shape

From `/api/consumer/redeem-reward`:

```ts
const currentBalance = ... // consumer or shop depending local role logic

await supabase
  .from('points_transactions')
  .insert({
    company_id: isIndependent ? null : shopId,
    user_id: user.id,
    points_amount: -pointsRequired,
    balance_after: newBalance,
    redeem_item_id: reward_id,
    transaction_type: 'redeem',
  })
```

Implication: current code can check one wallet and write a row that affects two wallets.

### Appendix D: Affected user data sample

Current live data for Allfan:

```text
Consumer balance: 6090
Shop balance: -160
Role: USER
Org type: SHOP
Historical redemption row: -10000, balance_after = 20, company_id = null
Derived into Brew Beauty shop ledger through phone matching
```

### Appendix E: Historical risk counts

```text
Total redemption rows: 39
Rows affecting both consumer and shop: 27
User-only rows that still derive into shop ledger: 18
Negative shops: 11
Redemption rows feeding negative shops: 19
```