# 21. RoadTour Registration Validation and Attribution Fix

Date: 2026-05-23

Scope of this change:
- fix RoadTour registration so Reference and Shop are mandatory authoritative selections
- block WhatsApp OTP start unless both selections are valid
- enforce the same validation on the server
- reuse existing schema only
- preserve RoadTour context through the registration handoff only where safe
- document the remaining attribution gap clearly

Explicit non-scope for this change:
- no SQL migrations
- no new tables
- no schema changes
- no new user category called RoadTour
- no attempt to fake permanent attribution by writing RoadTour data into unrelated columns

## 1. Executive Summary

The registration bug was caused by a mismatch between the picker components and the signup payload:
- the UI allowed the user to type or later alter shop text without preserving a stable selected shop id
- the signup flow did not persist the selected reference user id
- OTP start routes accepted only free-text signup basics and ignored authoritative Reference and Shop selections entirely
- final account creation still wrote only `referral_phone` and `shop_name` free text without authoritative revalidation

The implemented fix now does the following:
- the signup form stores the selected `reference_user_id` and selected shop `organization_id`
- changing or clearing the selected shop text invalidates the selected shop id and requires re-selection
- OTP start is blocked on the client until both selections remain authoritative
- OTP start and resend are blocked on the server if either selection is missing or invalid
- final account creation revalidates the canonical selections before writing the user profile
- registration now writes the existing authoritative linkage fields:
  - `users.reference_user_id`
  - `users.referral_phone` from the canonical selected reference
  - `users.organization_id` for the selected shop
  - `users.shop_name` from the canonical selected shop label

## 2. Files Inspected

Primary flow files inspected:
- `app/src/app/roadtour/[year]/[campaignSlug]/[referenceSlug]/page.tsx`
- `app/src/modules/roadtour/components/RoadtourJourneyWrapper.tsx`
- `app/src/components/journey/templates/PremiumLoyaltyTemplate.tsx`
- `app/src/components/ui/reference-picker.tsx`
- `app/src/components/ui/shop-picker.tsx`
- `app/src/app/api/reference/search/route.ts`
- `app/src/app/api/shops/search/route.ts`
- `app/src/app/api/auth/register/request-code/route.ts`
- `app/src/app/api/auth/register/resend-code/route.ts`
- `app/src/lib/actions.ts`
- `app/src/lib/engagement/profile-link-validation.ts`
- `app/src/app/api/user/update-profile/route.ts`
- `app/src/lib/roadtour/server.ts`

Reference docs inspected before implementation:
- `docs/roadtourmodules/18-user-registration-roadtour-attribution-assessment.md`
- `docs/roadtourmodules/19-registration-attribution-schema-planning-notes.md`
- `docs/roadtourmodules/20-registration-attribution-schema-proposal.md`

## 3. Current Validation Sources

Reference master source:
- `/api/reference/search`
- backed by eligible active reference users
- stable identifier: `reference_user_id`

Shop master source:
- `/api/shops/search`
- backed by active `organizations` rows where `org_type_code = 'SHOP'`
- stable identifier: `organization_id`

Existing schema reused safely:
- `users.reference_user_id`
- `users.referral_phone`
- `users.organization_id`
- `users.shop_name`

## 4. Implemented Fix

Client-side changes:
- signup now keeps `signUpReferenceUserId` and `signUpShopOrganizationId`
- OTP cannot start unless both selections remain valid
- field-level errors are shown when either authoritative selection is missing
- shop selection is invalidated as soon as the selected text is edited
- the signup flow continues to use the existing shop picker without any create-new-shop path

Server-side changes:
- new canonical server resolver validates that:
  - selected shop id exists
  - selected shop is active and `SHOP`
  - submitted shop text still matches the canonical selected shop label or organization name
  - selected reference user id exists
  - selected reference is active and eligible
  - submitted reference phone still matches the canonical selected reference
- `/api/auth/register/request-code` now rejects invalid shop/reference selections before any OTP code is created
- `/api/auth/register/resend-code` applies the same authoritative validation
- `registerConsumer` now revalidates the canonical selections before updating the new user profile
- `registerConsumer` now writes authoritative shop/reference linkage fields instead of relying on free text alone

## 5. RoadTour Context Preservation

What is preserved now:
- stable RoadTour context available from the validated RoadTour QR is carried through the OTP handoff in verification metadata only
- this temporary handoff stores safe registration-session context such as:
  - `token`
  - `campaign_name`
  - `account_manager_name`
  - `org_id`
  - `qr_code_id` when available
  - `campaign_id` when available
  - `account_manager_user_id` when available
- the same temporary context is also included in registration notification event metadata for audit visibility

Why this is safe:
- `auth_verification_codes.meta` is already a registration-session metadata container
- `notification_events.meta` is already an audit/event metadata container
- neither is being repurposed as an authoritative user attribute or reporting dimension

Important limitation:
- this does not create reliable user-level RoadTour attribution for future reporting
- it only preserves context across the current registration/OTP handoff and completion event logging

## 6. Attribution Gap After This Fix

The reporting gap remains:
- there is still no authoritative persistent registration attribution table tying the created user to RoadTour as a first-class source record
- no current existing user column can safely store full RoadTour attribution without overloading unrelated fields
- `users.organization_id` and `users.reference_user_id` improve linkage quality, but they are not equivalent to RoadTour source attribution

Accepted conclusion for this PR:
- validation bug is fixed now
- RoadTour context is preserved safely during the registration handoff
- permanent reportable RoadTour attribution still requires the future schema direction already documented in documents 18, 19, and 20

Preferred future direction remains:
- a server-controlled `registration_attributions` model with `source_module = 'roadtour'`
- no client-authored attribution writes
- no new user category for RoadTour

## 7. Tests Added

Added tests:
- `app/src/lib/engagement/registration-link-selection.test.ts`
- `app/src/lib/engagement/registration-link-resolution.test.ts`
- `app/src/app/api/auth/register/request-code/route.test.ts`
- updated `app/src/components/ui/shop-picker.test.tsx`

Covered behaviors:
- missing or free-text-only selections are rejected
- valid ids plus canonical values are accepted
- invalid Reference text shows the inline error on blur and clears after valid selection
- invalid Shop text shows the inline error on blur and clears after valid selection
- editing selected shop text invalidates the selection id
- live password validation distinguishes required, short, mismatch, and match states
- OTP start route rejects invalid authoritative selections before code creation or WhatsApp send

## 8. Field-level Validation Timing Fix

Current broken behavior before this update:
- Reference and Shop inline errors could appear too late because the parent form only knew about final selected ids, not about typed-but-unselected blur events.
- Reference free text was not propagated back to the form state while typing, so the form could not distinguish empty from invalid typed input reliably.
- Password mismatch was only enforced on submit, which is why the banner-level error in staging appeared before clear inline field feedback.

New validation timing behavior:
- Reference now propagates typed text back to form state and reports blur to the parent.
- If Reference is empty on blur, the form shows `Reference is required.`
- If Reference has typed text but no selected id on blur or when leaving the field, the form shows `Please select a valid reference from the list.`
- Shop now reports blur to the parent with the current text and whether a selected shop still exists.
- If Shop is empty on blur, the form shows `Shop name is required.`
- If Shop has typed text but no selected shop id on blur or when leaving the field, the form shows `Please select a valid shop from the list.`
- Password and Confirm Password are now validated live while typing.
- If Confirm Password differs, the form shows `Passwords do not match` inline before submit.
- If both password fields match and password length is valid, the form shows `Passwords match` inline.
- Clicking `Create Account` now focuses and scrolls to the first invalid field if any validation still fails.
- WhatsApp OTP cannot start when Reference, Shop, or password validation fails.

Files changed for the timing fix:
- `app/src/components/journey/templates/PremiumLoyaltyTemplate.tsx`
- `app/src/components/ui/reference-picker.tsx`
- `app/src/components/ui/shop-picker.tsx`
- `app/src/lib/engagement/registration-link-selection.ts`
- `app/src/app/api/auth/register/request-code/route.ts`
- `app/src/app/api/auth/register/resend-code/route.ts`

## 9. Staging Validation Checklist

Run through this checklist on staging:
1. Open a RoadTour registration URL and confirm campaign and account manager context still render correctly.
2. Type random text in Reference, then tab or click into Shop Name. Confirm Reference immediately shows `Please select a valid reference from the list.`
3. Clear Reference, leave the field, and confirm it shows `Reference is required.`
4. Type random text in Shop Name, then tab or click into Password. Confirm Shop shows `Please select a valid shop from the list.`
5. Clear Shop Name, leave the field, and confirm it shows `Shop name is required.`
6. Enter different Password and Confirm Password values. Confirm `Passwords do not match` appears before clicking Create Account.
7. Correct Confirm Password. Confirm `Passwords match` appears inline.
8. Keep Reference or Shop invalid and click Create Account. Confirm the OTP modal does not open and the form focuses the first invalid field.
9. Select a valid Shop, then edit the text. Confirm the selection is invalidated and signup is blocked until a new valid selection is made.
10. Select a valid Reference and valid Shop, then start signup. Confirm the WhatsApp OTP modal opens.
11. Complete OTP and registration. Confirm the created user has:
   - `reference_user_id` populated
   - canonical `referral_phone`
   - `organization_id` populated with the selected shop
   - canonical `shop_name`
12. Repeat with an invalid or stale selection payload through devtools or direct request replay. Confirm the server rejects OTP start.
13. Repeat an OTP resend flow after valid selections. Confirm resend still works.
14. Confirm no new shop is silently created from this flow when no result exists.
15. Confirm User Management or profile views still show the linked shop and reference correctly after signup.

## 10. Changed Files

Implementation files changed:
- `app/src/components/journey/templates/PremiumLoyaltyTemplate.tsx`
- `app/src/app/api/auth/register/request-code/route.ts`
- `app/src/app/api/auth/register/resend-code/route.ts`
- `app/src/lib/actions.ts`
- `app/src/lib/engagement/registration-link-selection.ts`
- `app/src/lib/engagement/registration-link-resolution.ts`
- `app/src/lib/roadtour/registration-context.ts`
- `app/src/lib/roadtour/server.ts`
- `app/src/modules/roadtour/components/RoadtourJourneyWrapper.tsx`

Test files changed:
- `app/src/lib/engagement/registration-link-selection.test.ts`
- `app/src/lib/engagement/registration-link-resolution.test.ts`
- `app/src/app/api/auth/register/request-code/route.test.ts`
- `app/src/components/ui/reference-picker.test.tsx`
- `app/src/components/ui/shop-picker.test.tsx`

## 11. Outcome

This change closes the immediate reliability bug:
- Reference and Shop are now mandatory authoritative selections
- the WhatsApp verification modal cannot open without them
- the server does not trust UI state alone
- final registration writes canonical existing linkage fields

This change does not claim to solve permanent RoadTour attribution reporting.
That remains a schema-level follow-up and should continue under the separate `registration_attributions` direction already proposed.

## 12. Create New Shop Fallback

This update adds the missing fallback for RoadTour and premium-loyalty public registration when the consumer's shop is not yet present in master data.

What changed:
- existing shop selection remains authoritative and still requires a real `organization_id`
- typed-only shop text is still rejected on both the client and the server
- the empty shop-picker state now exposes a `Create New Shop` CTA
- the create-shop dialog now has a prepare-only signup mode that validates fields and checks likely duplicates without creating the organization immediately
- the pending shop draft is carried through the existing WhatsApp OTP verification metadata
- the actual shop organization is created only after OTP verification succeeds during final registration
- the newly created shop is then linked back into `users.organization_id` and `users.shop_name`

Why this approach was chosen:
- it reuses the existing registration WhatsApp OTP trust boundary instead of introducing a public unauthenticated create-shop API
- it preserves the existing authoritative-selection rule for both Reference and Shop
- it avoids schema changes, temporary attribution hacks, or free-text-only fallback writes

Operationally important behavior:
- editing the displayed shop text after selecting an existing shop or preparing a new one invalidates that selection and requires re-selection or re-preparation
- if a real existing shop id is present, it wins over any stale pending-shop draft
- duplicate review still happens before the user is allowed to continue with the new-shop path
