# Production Signup validateSignUpLinkSelections Runtime Error

Date: 2026-05-23

## Screenshot error text

Production mobile screenshots showed raw JavaScript errors inside the Create Account modal:

- `validateSignUpLinkSelections is not defined`
- `Can't find variable: validateSignUpLinkSelections`

## Affected routes

The affected surfaces share the same premium loyalty/product tracking registration component:

- product tracking registration flow on `serapod2u.com`
- RoadTour reward registration flow on `serapod2u.com`
- public QR/product scan registration paths that render the shared Create Account modal

## Files inspected

- `app/src/components/journey/templates/PremiumLoyaltyTemplate.tsx`
- `app/src/lib/engagement/registration-link-selection.ts`
- `app/src/lib/engagement/registration-link-selection.test.ts`
- `app/src/app/api/auth/register/request-code/route.ts`
- `app/src/app/api/auth/register/resend-code/route.ts`
- `app/src/lib/actions.ts`
- `app/src/modules/roadtour/components/RoadtourScanPage.tsx`

## Root cause

The current registration validation helper is `validateRegistrationLinkSelections` in `registration-link-selection.ts`.
The shared signup component had a local wrapper named `validateSignUpLinkSelections`, and production screenshots prove a deployed bundle could enter a path where that local wrapper name was not available at runtime. The form error handler then displayed the raw JavaScript exception to users.

Current staging code already imported the canonical helper, so this was most likely a production deployment mismatch or stale/divergent bundle from the earlier registration-validation change. The fix still removes the risky local symbol from the runtime path so the same raw `ReferenceError` cannot be produced by current code.

## Fix

- Replaced the production-visible local wrapper name with `runSignUpLinkSelectionValidation`.
- The wrapper calls the canonical imported `validateRegistrationLinkSelections` helper.
- The wrapper catches unexpected validation exceptions and shows a friendly user-facing message:
  - `We couldn't validate the form. Please review the highlighted fields and try again.`
- The real error is still logged to the developer console for debugging.
- Reference and Shop validation remain enforced; the fix does not bypass validation.

## Duplicate registration components

No second Create Account implementation was changed for this issue. The product tracking and RoadTour reward registration surfaces use `PremiumLoyaltyTemplate.tsx` for this modal path. `RoadtourScanPage.tsx` has its own claim/login flow, but it was not the source of the reported `validateSignUpLinkSelections` symbol.

## Staging status

The staging worktree no longer contains `validateSignUpLinkSelections` references under `app/src`.

## No SQL or schema change

No SQL migration, table, column, or database schema change was created for this fix.

## Staging checklist

1. Open staging product tracking registration on a mobile browser.
2. Fill Email, Full Name, and Phone.
3. Type random Reference text, leave the field, and confirm inline validation appears with no raw JavaScript error.
4. Select a valid Reference and confirm no runtime error.
5. Type random Shop text without selecting or creating a shop and confirm inline validation appears with no runtime error.
6. Select an existing shop or create a shop through the OTP-gated Create New Shop flow.
7. Submit valid details and confirm the WhatsApp OTP modal opens only after validation passes.
8. Repeat on a RoadTour reward registration URL.