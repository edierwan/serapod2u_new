# Transport Request: Localhost → Staging Test Fixes

**Date:** 20 June 2026
**Branch:** `fix/localhost-staging-test-issues-20260620`
**Base:** `origin/staging` (commit `adf75263`)
**Status:** Active

---

## Issue Register

---

### LST-001: Broken image thumbnails in Categories tab and Landing Pages Products step

**Status:** ✅ Fixed

**Pages/URLs:**
1. Supply Chain → Products → Master Data → Categories tab
   `/supply-chain` → Products section → Master Data → Categories
2. Customer Growth → Marketing → Landing Pages → Edit → Products step
   `/customer-growth` → Marketing → Landing Pages → Edit → Step 3 (Products)
3. (Related) Public landing page `/lp/[slug]` — hero + product card images

**Screenshot/Reference:**
- Categories table shows 4 category rows (Electronic, Outdoor, Pet Food, Vape) where the Image column displays a broken `<img>` with alt text instead of a proper category icon.
- Landing Pages editor → Products step shows broken product thumbnails in both the catalog table and the selected-products panel.

**Problem:**
Image URLs from seed data point to an old cloud Supabase project (`hsvmvmurvpqcdmxckhnz.supabase.co`), but the current staging environment uses a self-hosted Supabase instance at `supabase-stg-serapod.getouch.cloud`. The images physically don't exist in the current storage, causing broken image icons.

Additionally, if any image URL fails to load for any reason (network, permissions, wrong path), there was no graceful fallback — just a broken image placeholder.

**Root Cause:**
1. **Wrong storage origin in seed data:** `image_url` values contain hardcoded URLs to `hsvmvmurvpqcdmxckhnz.supabase.co` (an old cloud Supabase project). This project is no longer in use.
2. **Missing `getStorageUrl()` call:** Unlike the Variants tab which uses `getStorageUrl(variant.image_url)` to dynamically rewrite storage URLs to the current Supabase instance, the Categories tab and Landing Pages components rendered `image_url` directly without any URL transformation.
3. **No image error handling:** There was no `onError` handler on the `<img>` tags, so even if `getStorageUrl()` was used but the image still failed (file doesn't exist), the broken image would display.

**Files Changed:**
| File | Change |
|------|--------|
| `app/src/components/shared/SafeImage.tsx` | **New** — reusable defensive `<img>` wrapper. Applies `getStorageUrl()`, tracks `onError` in local state, and renders a clean icon fallback (default `Package`) when the URL is missing or fails to load. |
| `app/src/components/products/tabs/CategoriesTab.tsx` | Refactored to use `SafeImage`. Removed inline `brokenImages` Set state, `getStorageUrl` import, and `ImageOff` import. Behavior is identical (gray rounded box with `Package` icon on failure). |
| `app/src/modules/marketing/components/LandingPagesAdminView.tsx` | Replaced 5 raw `<img>` blocks with `SafeImage`: ListView card thumbnail, ListView table thumbnail, `HeroPreview` image, `StepProducts` catalog row thumbnail, `StepProducts` selected-panel thumbnail. All now get `getStorageUrl()` rewriting + `onError` fallback. |
| `app/src/app/lp/[slug]/LandingPageClient.tsx` | Replaced 2 raw `<img>` blocks with `SafeImage`: public hero image and product card image. End customers no longer see broken images on published landing pages. |

**Fix Summary:**
1. Created a single reusable `SafeImage` component that encapsulates the fix pattern:
   - Calls `getStorageUrl(src)` to rewrite storage URLs to the current Supabase instance.
   - Tracks load errors in local `useState`.
   - When the URL is missing/empty OR fails to load (`onError`), renders a clean fallback: a gray rounded box with a `Package` icon (configurable via props).
2. Applied `SafeImage` to all product/category/hero image renderings across the three affected files (9 total image renderings).
3. Refactored `CategoriesTab.tsx` (already fixed in a prior commit) to use the shared component for consistency, removing ~15 lines of duplicated state/logic.

**How to Test on Localhost:**
1. `cd app && npm run dev`
2. **Categories tab:** Navigate to Supply Chain → Products → Master Data → Categories. Verify all 4 category rows (Electronic, Outdoor, Pet Food, Vape) show the fallback `Package` icon instead of broken images.
3. **Landing Pages Products step:** Navigate to Customer Growth → Marketing → Landing Pages → Edit any page → go to Step 3 (Products). Verify product thumbnails in both the catalog table and the selected-products panel show the fallback icon instead of broken images.
4. **Public landing page:** Open `/lp/[slug]` for any published page. Verify the hero image and product card images show the fallback icon when the source URL is broken.
5. **No regression:** Verify other tabs (Brands, Groups, Sub-Groups, Variants, New Product) still show their proper images — changes only affect image rendering, not data flow.
6. **Type check:** `cd app && npx tsc --noEmit` (note: a pre-existing TS error exists in `CategoriesTab.tsx` line 95 `handleSave` insert call — unrelated to this fix and present in HEAD).
7. **Tests:** `cd app && npm run test` (note: 9 pre-existing test failures in `shop-requests/core.test.ts` phone validation — unrelated to this fix).

**Scope of Issue:**
| Area | Affected? | Reason |
|------|-----------|--------|
| Categories Tab | ✅ Fixed | Now uses `SafeImage` (was raw `image_url` + manual `brokenImages` Set) |
| Landing Pages — List view thumbnails | ✅ Fixed | Now uses `SafeImage` (was raw `hero_image_url`) |
| Landing Pages — Hero preview | ✅ Fixed | Now uses `SafeImage` (was raw `hero_image_url`) |
| Landing Pages — Products step (catalog + selected) | ✅ Fixed | Now uses `SafeImage` (was raw `product.image_url`) |
| Public landing page (`/lp/[slug]`) | ✅ Fixed | Now uses `SafeImage` (was raw `heroImage` / `imageUrl`) |
| Brands Tab | ❌ No | Brands have no image column in the table |
| Groups Tab | ❌ No | Groups have no image column in the table |
| Sub-Groups Tab | ❌ No | Sub-groups have no image column in the table |
| Variants Tab | ❌ No | Already uses `getStorageUrl(variant.image_url)` with proper handling |
| New Product View | ❌ No | Product editing uses different image flow with upload |

---

### LST-002: Notification Provider email setup redesign

**Status:** ✅ Fixed locally

**Page/URL:** `/notifications/providers`

**Problem:**
Email configuration used a basic provider dropdown and did not support the Serapod2U SMTP domain flow. The existing generic test button also called a WhatsApp-only endpoint, so email connection testing could not work.

**Files Changed:**
| File | Change |
|------|--------|
| `app/src/components/settings/NotificationProvidersTab.tsx` | Reworked Email into the default channel view with provider cards, SMTP defaults/form, DNS/Test Email/Usage side cards, responsive actions, and active-provider save flow. Existing WhatsApp, SMS, and non-SMTP email forms remain available. |
| `app/src/app/api/settings/notifications/providers/email/test/route.ts` | New authenticated localhost-compatible SMTP verify/test-send endpoint used by the new Test Connection and Test Email controls. |

**Fix Summary:**
1. Added Use My Domain (SMTP), Gmail OAuth2, SendGrid, AWS SES, Resend, Postmark, and Mailgun provider cards.
2. Added the requested `serapod2u.com` defaults without hardcoding a password.
3. Added masked SMTP password entry and retained the existing provider persistence path.
4. Added DNS status placeholders with an explicit placeholder label until live DNS verification is connected.
5. Added connection verification, one-recipient test-email support, save, and set-active actions.
6. Kept WhatsApp and SMS behavior unchanged; Email is now the initially selected channel.
7. Replaced channel, provider, status, DNS, test-email, and email-usage placeholders with the local SVG assets from `app/public/images/serapod_notification_icons/`; the assets remain in their existing folder.

**How to Test on Localhost:**
1. `cd app && npm run dev`
2. Open `/notifications/providers` and verify Email is selected.
3. Select each email provider card and confirm its existing configuration fields still appear.
4. Select Use My Domain (SMTP), enter the SMTP password, and use Test Connection.
5. Save Configuration, reload, and confirm the provider and fields persist with the password masked.
6. Enter one recipient in Test Email and confirm one message is sent.
7. Verify the layout at desktop and tablet/mobile widths.
8. Type check: `cd app && npx tsc --noEmit`.

**Scope/Safety:**
- Localhost only; not pushed.
- No migration or database schema change.
- SMTP password is never hardcoded or rendered as plain text by default.
- Live DNS checks remain an explicitly labelled UI placeholder.
- No WhatsApp/SMS provider options were removed.

---

### LST-003: Restore RoadTour Reference checkbox in User Management

**Status:** ✅ Fixed locally

**Problem:**
The redesigned Add/Edit User wizard retained the existing `can_be_reference` form state and persistence paths but omitted the checkbox that administrators used to change it.

**Original implementation confirmed:**
- Database field: `public.users.can_be_reference` from `20260407_reference_eligibility_and_shop_autocomplete.sql` (default `false`).
- Create/update persistence: existing `createUserWithAuth`, `updateUserWithAuth`, and `UserManagementNew` payload handling.
- RoadTour eligibility: existing active-user query in `RoadtourCampaignsView` filters `can_be_reference = true`; its current client search covers name, call name, email, and phone.
- Historical assignments remain in `roadtour_campaign_managers`; changing eligibility does not delete them.

**Files Changed:**
| File | Change |
|------|--------|
| `app/src/components/users/UserDialogNew.tsx` | Restored a normal `Reference` checkbox below Active in the shared Add/Edit Role & Access step, bound to the existing `can_be_reference` form property. |
| `app/src/types/user.ts` | Added the existing database flag to the application `User` type. |
| `app/src/components/users/UserReferenceCheckbox.test.tsx` | Added checked/unchecked rendering and change-propagation coverage. |

**Verification:**
- Targeted User Management tests: 10/10 passed.
- Localhost server responded successfully; authenticated wizard inspection requires an existing local login session.
- Full-project typecheck remains blocked by pre-existing unrelated repository errors; no reported error points to these changed files.
- No migration added or run, no existing records changed, and nothing pushed.

---

### LST-004: RoadTour QR delivery honors Notification Types routing

**Status:** ✅ Fixed locally

**Problem:**
The QR Management send action called the WhatsApp gateway directly, so selecting **Email Only** under Notification Types still produced a WhatsApp 503 error. The routing guidance banner also continued to describe WhatsApp fallback regardless of the selected default.

**Fix:**
- Retained the existing authenticated RoadTour endpoint but made it resolve the saved Default Delivery Method.
- Email Only queues one email to each Reference user's existing email address using the active email provider and includes the campaign, Reference name, QR URL, and QR image URL.
- WhatsApp routes retain the existing QR-image gateway behavior; SMS-only now reports that RoadTour SMS delivery is not configured instead of silently trying WhatsApp.
- QR Management now uses neutral send wording/icon styling and reports the actual selected channel.
- Notification Types guidance now reflects the currently selected preset.
- Added routing resolution tests, including global Email Only versus an event-level override.

**Safety/Verification:**
- No real message was sent during tests.
- No migration or database record update was required.
- Targeted routing, Notification Types, and RoadTour tests: 7/7 passed.
- Existing provider configuration and WhatsApp behavior were not changed.
- Nothing pushed.

---

## Branch Information

| Detail | Value |
|--------|-------|
| Branch name | `fix/localhost-staging-test-issues-20260620` |
| Based on | `origin/staging` (commit `adf75263`) |
| Status | Active development |
| Staging pushed? | ❌ No |
| Main touched? | ❌ No |
| Database modified? | ❌ No |
| Migrations run? | ❌ No |

## Safety Notes

- LST-001 is frontend-only. LST-002 adds one authenticated SMTP test endpoint; there are no database schema changes or migrations.
- The fix uses the existing `getStorageUrl()` utility (already proven in VariantsTab) wrapped in a new reusable `SafeImage` component.
- The fallback behavior (showing a gray `Package` icon) is the same visual pattern that was already the default when `image_url` was null — we just extended it to also cover broken images and centralized it.
- If in the future images are uploaded to the correct Supabase storage, `getStorageUrl()` will automatically resolve them to the correct URL.
- Pre-existing TS error in `CategoriesTab.tsx` (line 95, `handleSave` insert) and pre-existing test failures in `shop-requests/core.test.ts` are unrelated to this fix and present in HEAD.
