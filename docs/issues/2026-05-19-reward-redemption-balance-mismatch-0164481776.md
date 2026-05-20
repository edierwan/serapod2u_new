# Reward Redemption Balance Mismatch Assessment

Date: 2026-05-19
Issue: Production reward redemption failure for phone `0164481776`
Affected user: `c2d40146-c034-4e04-96ce-c193dd25e576` (`Allfan`)
Affected shop: `f9bce912-645e-441f-a5cd-291e7806d2a8` (`Brew Beauty`)
Affected reward: `RM500 CASH` (`CASHBACK-CLAIM-DUIT-RM500`)

## Summary

The user cannot redeem `RM500 CASH` because the mobile loyalty UI and the redemption API are using different point-balance scopes for the same account.

- The mobile UI profile flow shows the user's consumer-scoped balance.
- The redemption API enforces the shop-scoped aggregate balance for this user.
- For this user, those two balances are different:
  - Consumer balance: `5990`
  - Shop aggregate balance: `-260`

This is why the UI shows enough points to redeem, but the API rejects the redemption with an insufficient-points error.

## Production Evidence

Read-only checks were run on production via SSH and Postgres. No data was modified.

### 1. User and balance scope data

Query result for phone `0164481776`:

- User ID: `c2d40146-c034-4e04-96ce-c193dd25e576`
- Name: `Allfan`
- Phone: `+60164481776`
- Role: `USER`
- Organization: `Brew Beauty`
- Org type: `SHOP`
- Consumer balance: `5990`
- Shop balance: `-260`

### 2. Reward definition

Production reward row:

- Reward: `RM500 CASH`
- Item code: `CASHBACK-CLAIM-DUIT-RM500`
- Category: `other`
- Points required: `5000`
- Active: yes

### 3. Consumer balance summary

Production `v_consumer_points_balance` for the affected user:

- Current balance: `5990`
- Total collected system: `10380`
- Total migration: `5580`
- Total redeemed: `10000`
- Transaction count: `1074`

### 4. Shop aggregate balance summary

Production `v_shop_points_balance` for the affected shop:

- Current balance: `-260`
- Total earned scans: `4130`
- Total redeemed: `10000`
- Scan count: `413`
- Redemption count: `1`

### 5. Shop ledger aggregate

Production `shop_points_ledger` aggregate for the affected shop:

- `scan / scan`: `+4130`
- `MIGRATION / migration`: `+5580`
- `earn / bonus`: `+30`
- `redeem / redemption`: `-10000`

Net result:

$$4130 + 5580 + 30 - 10000 = -260$$

That matches the shop aggregate balance currently enforced by the redemption API.

## Root Cause

The root cause is inconsistent role classification between the profile/balance display path and the reward redemption path.

### UI/Profile path

The profile API uses `resolveTrustedPointsBalance(...)`, which treats role `USER` as consumer-scoped.

Relevant logic:

- `app/src/lib/utils/qr-resolver.ts`
- `CONSUMER_SCOPED_ROLE_CODES = new Set(['GUEST', 'CONSUMER', 'USER'])`
- `resolveTrustedPointsBalance(...)` returns consumer balance when role is consumer-scoped.

The mobile rewards UI reads `pointsBalance` from `/api/user/profile`, so this user sees `5990` points available.

### Redemption API path

The redemption API uses a different rule.

Relevant logic:

- `app/src/app/api/consumer/redeem-reward/route.ts`
- `const isConsumerRole = ['GUEST', 'CONSUMER'].includes(userProfile.role_code || '')`

Because this user has role `USER`, not `GUEST` or `CONSUMER`, the API does not treat them as consumer-scoped.
Since the user is linked to a `SHOP` organization, the API loads `v_shop_points_balance` instead of `v_consumer_points_balance`.

That means the API checks `-260 < 5000` and returns:

- `Insufficient points. You need 5000 points but have -260.`

## Why the UI Looked Wrong

The rewards screen and confirmation modal were built using the already-loaded `userPoints` state.
That state came from `/api/user/profile`, which returned the consumer balance (`5990`).

So the client calculated:

$$5990 - 5000 = 990$$

and displayed a positive post-redemption balance, while the server enforced the shop aggregate balance (`-260`).

This is not a stock issue and not a reward-definition issue.
The reward itself is active and correctly configured at `5000` points.

## Why Bank Information Is Not The Root Cause

The user's bank account can be correct and this issue still occurs.

Reason:

- The insufficient-points rejection happens before any payout-processing concern matters.
- The redemption API branch that fails is the balance check branch.
- The API does not reject this request because of bank details.

So bank information is not the blocking condition for this incident.

## Likely Intended Product Behavior

Based on the current product surfaces, the intended behavior appears to be that this user redeems using their individual tracked balance:

- The mobile UI shows their individual available points.
- The staff performance monitoring surface shows this staff account with a positive balance.
- The current profile resolver explicitly classifies `USER` as consumer-scoped.

That makes the redemption API behavior the inconsistent side, not the UI.

## Recommended Fix

### Preferred fix

Unify the redemption API with the same shared resolver already used by the profile API.

In `app/src/app/api/consumer/redeem-reward/route.ts`:

- stop using the local `isConsumerRole = ['GUEST', 'CONSUMER']...` rule
- use the shared `resolveTrustedPointsBalance(...)`
- or at minimum align the role classification so `USER` is treated consistently

That will make the balance checked by the server match the balance shown in the UI.

### Minimum-risk implementation approach

1. Import and use `resolveTrustedPointsBalance(...)` in the redemption route.
2. Pass:
   - `userId: user.id`
   - `roleCode: userProfile.role_code`
   - `organizationId: userProfile.organization_id`
3. Use the returned `balance` as the single source of truth for redemption eligibility.
4. Keep the UI display using the same resolver result so both sides stay aligned.

### Additional hardening

After fixing the server-side balance source, also harden the client flow:

1. Ensure the pre-confirmation eligibility check uses the same balance source semantics.
2. Prefer server-confirmed `current_balance` when showing insufficient-points details.
3. Add regression coverage for shop-linked `USER` role accounts.

## Regression Tests To Add

1. Shop-linked user with role `USER` and positive consumer balance should be allowed to redeem when the shared balance resolver says they have enough points.
2. Shop-linked user with role `USER` should see the same balance in:
   - `/api/user/profile`
   - `/api/consumer/redeem-reward`
3. Shop-linked `GUEST` and `CONSUMER` roles should continue using consumer-scoped balances.
4. True shop-aggregate redemption accounts, if any exist by product definition, should remain explicitly covered by tests.

## Conclusion

This incident is caused by a balance-source mismatch, triggered specifically by role `USER` on a shop-linked account.

- UI/profile path: consumer-scoped balance `5990`
- Redemption API path: shop-scoped balance `-260`
- Reward requirement: `5000`

Because of that mismatch, the user is shown enough points to redeem but is rejected by the backend.

No production changes were made during this assessment.
