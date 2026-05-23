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
- the create-shop dialog now has a two-step public signup mode: Shop Details, then Verify Contact Phone
- Contact Phone must normalize to a valid Malaysia mobile number before any OTP is sent
- the dialog sends a separate 4-digit WhatsApp OTP to the shop contact mobile number before creating the organization
- the actual shop organization is created immediately after that shop-contact OTP verification succeeds
- the newly created shop is linked back into the registration form as the selected authoritative shop before account creation continues
- the later user registration OTP flow still runs independently for the registrant's own mobile number

Why this approach was chosen:
- it reuses the existing `auth_verification_codes`, `notification_events`, verification-token lifecycle, and WhatsApp gateway integration instead of inventing a second OTP stack
- it preserves the existing authoritative-selection rule for both Reference and Shop by returning a real created `organization_id`
- it avoids schema changes, temporary attribution hacks, or free-text-only fallback writes

Operationally important behavior:
- editing the displayed shop text after selecting an existing shop or after a newly created shop is linked invalidates that selection and requires a fresh valid selection
- the public create flow clears any stale pending-shop draft and keeps the real created shop id authoritative
- duplicate review still happens before OTP send, and exact duplicate checks run again before final insert

## 13. Create New Shop contact phone validation and OTP verification

Files inspected and changed for this update:
- `app/src/components/shop-requests/CreateShopDialog.tsx`
- `app/src/components/journey/templates/PremiumLoyaltyTemplate.tsx`
- `app/src/lib/utils.ts`
- `app/src/utils/phone.ts`
- `app/src/server/auth/registrationVerificationService.ts`
- `app/src/server/auth/shopContactVerificationService.ts`
- `app/src/lib/shop-requests/core.ts`
- `app/src/lib/shop-requests/create-shop.ts`
- `app/src/app/api/shops/contact-verification/request-code/route.ts`
- `app/src/app/api/shops/contact-verification/resend-code/route.ts`
- `app/src/app/api/shops/contact-verification/verify-code/route.ts`
- `app/src/app/api/shops/contact-verification/create/route.ts`
- `app/middleware.ts`

Utility reuse and validation rules:
- canonical phone storage remains E.164 with leading `+`
- the dialog and server reuse the existing phone normalization path and now enforce a Malaysia mobile rule for shop contact numbers
- accepted inputs include local and canonical forms such as `0123456789`, `60123456789`, and `+60123456789`
- obvious landline or malformed inputs such as `03-1234 5678` are rejected with `Please enter a valid Malaysia mobile number.`

OTP lifecycle now implemented:
- Step 1 validates all required shop fields and runs duplicate checks before any OTP is issued
- Step 2 sends a 4-digit WhatsApp OTP to the normalized shop contact mobile number using the existing verification code table and gateway
- the verify route returns a short-lived verification token only after the correct code is entered
- the create route accepts that verification token, rehydrates the verified `shop_request` from verification metadata, and only then inserts the new `organizations` row
- after create succeeds, the verification code is marked used and the created shop is returned to the signup form as the authoritative selected shop

Duplicate prevention now enforced:
- exact normalized `contact_phone` matches on existing active shops hard-block the create flow
- exact normalized shop identity matches based on `shop_name` plus submitted branch, state, or address also hard-block the create flow where enough location detail is present
- fuzzy name matches still show likely existing shops and require the user to explicitly continue before an OTP is sent
- the final create route rechecks exact duplicates again before insert so the shop cannot be created if a matching record appeared after OTP send

Server-side enforcement details:
- public shop creation is no longer a blind client-side draft handoff
- the create endpoint requires a verified shop-contact token and ignores any unverified client-authored shop payload at insert time
- server validation in `shop-requests/core` enforces required fields, Malaysia mobile phone format, and email validation
- middleware explicitly exposes `/api/shops/contact-verification/*` as public so the anonymous RoadTour registration flow can use these endpoints without opening unrelated protected routes

Link-back behavior in the registration form:
- after verified shop creation, `PremiumLoyaltyTemplate` stores the created `organization_id` in `signUpShopOrganizationId`
- the signup form clears any old `signUpPendingShopRequest`
- the shop display text is updated to the created shop label, so the normal authoritative-selection validation continues to work without special casing

RoadTour context note:
- this shop-contact OTP flow does not change the existing RoadTour registration attribution boundary
- RoadTour context still flows only through the separate user-registration OTP metadata already described above
- no new RoadTour-specific user columns, attribution writes, or schema hacks were introduced by the shop-contact verification change

No SQL / schema confirmation:
- no SQL migration was added
- no new table or column was introduced
- the implementation reuses `auth_verification_codes`, `notification_events`, and existing organization creation helpers only

Focused tests added or updated:
- `app/src/utils/phone.test.ts`
- `app/src/lib/shop-requests/core.test.ts`
- `app/src/components/shop-requests/CreateShopDialog.test.tsx`

Staging validation checklist for this change:
1. Open a public RoadTour or premium-loyalty signup page, search for a missing shop, and click `Create New Shop`.
2. Enter a landline or malformed contact number such as `03-1234 5678`. Confirm the dialog shows `Please enter a valid Malaysia mobile number.` and does not proceed.
3. Enter a valid Malaysia mobile number and complete the remaining required fields. Confirm `Continue` sends a WhatsApp OTP and switches the dialog to the verification step.
4. Confirm resend is blocked by cooldown, then becomes available again after the countdown.
5. Enter an invalid 4-digit code. Confirm the dialog shows the verification failure and does not create a shop.
6. Enter the correct 4-digit code. Confirm the shop is created immediately, the dialog closes, and the signup form now has the created shop selected as the authoritative shop.
7. Retry with a shop whose exact contact phone or exact normalized name plus location already exists. Confirm creation is blocked and the dialog tells the user to select the existing shop instead.
8. Retry with only fuzzy name matches. Confirm the dialog shows the likely existing shops and requires explicit continuation before sending OTP.
9. Finish the normal user-registration OTP flow after the shop is created. Confirm the resulting user is linked to the created `organization_id`.
10. Confirm no pending-shop-only fallback is left behind for the happy path; the final registration should be using the real created shop id.

## 14. Create New Shop shop-name title case normalization

Files changed for this update:
- `app/src/lib/shop-requests/shop-name-formatting.ts`
- `app/src/lib/shop-requests/core.ts`
- `app/src/components/shop-requests/CreateShopDialog.tsx`
- `app/src/lib/shop-requests/shop-name-formatting.test.ts`
- `app/src/components/shop-requests/CreateShopDialog.test.tsx`

Formatter behavior:
- Shop Name is formatted only in the Create New Shop modal/panel.
- While typing, completed words are formatted when the user types a trailing space.
- On blur and submit, the full shop name is normalized.
- Submit normalization trims leading/trailing spaces and collapses repeated spaces to one space.
- The normalized shop name is sent to the duplicate-check OTP request and to the final create flow.

Examples:
- `test new shop` -> `Test New Shop`
- `kedai maju jaya` -> `Kedai Maju Jaya`
- `RESTORAN ALI MAJU` -> `Restoran Ali Maju`
- `mini mart taman desa` -> `Mini Mart Taman Desa`
- `99 speedmart taman desa` -> `99 Speedmart Taman Desa`
- `7-eleven seksyen 9` -> `7-Eleven Seksyen 9`
- `s.box station` -> `S.Box Station`

Special-case handling:
- known brand/acronym tokens are preserved or canonicalized where safe, including `S.Box`, `ABC`, `KK`, `U`, `MR`, `DIY`, `Mydin`, and `7-Eleven`
- number-only tokens are preserved
- unknown dotted, numbered, or hyphenated tokens are handled conservatively so intentional brand casing is not aggressively rewritten

Validation interaction:
- Shop Name required validation still runs after normalization
- duplicate checks use the normalized shop name
- final shop creation uses the normalized shop name
- OTP behavior is unchanged: no shop is created before valid phone and OTP verification succeeds
- selected shop id is still set after successful verified shop creation

No SQL / schema confirmation:
- no SQL migration was added
- no table, column, enum, or database schema change was created

Staging checklist:
1. Type `test new shop ` in Shop Name. Confirm it becomes `Test New Shop ` after pressing space.
2. Type `kedai maju jaya`, leave the field, and confirm it becomes `Kedai Maju Jaya`.
3. Type `99 speedmart taman desa`, leave the field, and confirm it becomes `99 Speedmart Taman Desa`.
4. Type `7-eleven seksyen 9`, leave the field, and confirm it becomes `7-Eleven Seksyen 9`.
5. Continue the Create New Shop flow and confirm duplicate check uses the normalized name.
6. Complete contact-phone OTP verification and confirm the created shop uses the normalized name.
7. Confirm no shop is created before OTP verification succeeds.
