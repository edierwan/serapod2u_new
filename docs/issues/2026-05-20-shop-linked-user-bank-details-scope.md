# Shop-Linked User Bank Details Scope

## Summary

Production cashback bank-detail failures for shop-linked mobile users were caused by scope mismatch, not by invalid account numbers.

- Affected production example: `0136960042` / `+60136960042`, Muhammad Safwan Bin Abdullah, linked to shop `Evape`
- User bank fields were already valid on `public.users`
- Shop organization bank fields were `NULL` on `public.organizations`
- Mobile profile save/read paths were switching bank scope to `organizations` for SHOP-linked users
- Cashback redemption needed to follow the business rule that mobile cashback is individual-user scoped

## Why This Is Not The Points Wallet Bug

This issue is separate from the reward wallet-scope defect.

- Wallet bug: points balance ownership and redemption source-of-truth mismatch
- Bank-details bug: mobile cashback bank data stored/read from the wrong table for shop-linked users

No points ledger logic was changed in this fix.

## Business Rule

Mobile cashback redemption is individual-user scoped.

- Mobile users save bank details to `public.users`
- Mobile users read bank details from `public.users`
- Mobile cashback redemption validates payout readiness from `public.users.bank_id` + `public.users.bank_account_number`
- Organization bank details remain for explicit organization/admin payout flows only

## Code Paths Changed

- `app/src/app/api/user/profile/route.ts`
  - always returns mobile bank fields from the authenticated user row
- `app/src/app/api/user/update-profile/route.ts`
  - always writes personal bank fields to `public.users`
  - validates Malaysian bank rules against `msia_banks`
- `app/src/app/api/consumer/redeem-reward/route.ts`
  - validates cashback payout readiness from personal user bank data only
- `app/src/lib/engagement/personal-bank-details.ts`
  - shared personal-bank read/update/validation helpers

## Regression Coverage

Tests added for:

- shop-linked mobile profile loads personal user bank details
- shop-linked mobile bank save writes `users`, not `organizations`
- cashback redemption accepts a valid Maybank personal account from the user row
- cashback redemption fails with `Please save a valid personal bank account before redeeming cashback.` when `user.bank_id` is missing
- Maybank `557175482611` passes validation
- organization bank admin route still writes `organizations.bank_id`

## Operational Notes

- No production data was modified
- No production migration was run
- No points ledger logic was changed