# Transport Request: Localhost → Staging Test Fixes

**Date:** 20 June 2026
**Branch:** `fix/localhost-staging-test-issues-20260620`
**Base:** `origin/staging` (commit `adf75263`)
**Status:** Active

---

## Issue Register

---

### LST-001: Category images showing broken placeholders in Supply Chain → Products → Master Data → Categories

**Status:** ✅ Fixed

**Page/URL:**
Supply Chain → Products → Master Data → Categories tab
`/supply-chain` → Products section → Master Data → Categories

**Screenshot/Reference:**
Categories table shows 4 category rows (Electronic, Outdoor, Pet Food, Vape) where the Image column displays a broken `<img>` with alt text instead of a proper category icon.

**Problem:**
Category images from seed data have `image_url` values pointing to an old cloud Supabase project (`hsvmvmurvpqcdmxckhnz.supabase.co`), but the current staging environment uses a self-hosted Supabase instance at `supabase-stg-serapod.getouch.cloud`. The images physically don't exist in the current storage, causing broken image icons.

Additionally, if any image URL fails to load for any reason (network, permissions, wrong path), there was no graceful fallback - just a broken image placeholder.

**Root Cause:**
1. **Wrong storage origin in seed data**: Category `image_url` values contain hardcoded URLs to `hsvmvmurvpqcdmxckhnz.supabase.co` (an old cloud Supabase project). This project is no longer in use.
2. **Missing `getStorageUrl()` call**: Unlike the Variants tab which uses `getStorageUrl(variant.image_url)` to dynamically rewrite storage URLs to the current Supabase instance, the Categories tab rendered `image_url` directly without any URL transformation.
3. **No image error handling**: There was no `onError` handler on the `<img>` tag, so even if `getStorageUrl()` was used but the image still failed (file doesn't exist), the broken image would display.

**Files Changed:**
| File | Change |
|------|--------|
| `app/src/components/products/tabs/CategoriesTab.tsx` | 3 lines changed |

**Fix Summary:**
1. Added import for `getStorageUrl` from `@/lib/utils` - this is the same utility used by VariantsTab to rewrite storage URLs to the current Supabase instance
2. Wrapped `category.image_url` with `getStorageUrl()` to dynamically rewrite the URL: `getStorageUrl(category.image_url) || category.image_url`
3. Added `onError` handler to track broken images in component state
4. Added `brokenImages` Set state to track which category images have failed to load
5. When image is missing (`null`/empty) OR has failed to load (`onError`), a clean fallback `<Package>` icon is shown instead of a broken image placeholder
6. The `ImageOff` icon was added to imports for potential future use

**How to Test on Localhost:**
1. `cd app && npm run dev`
2. Navigate to Supply Chain → Products → Master Data
3. Click the "Categories" tab
4. Verify that all 4 category rows (Electronic, Outdoor, Pet Food, Vape) show the fallback `<Package>` icon instead of broken images
5. The fallback icon appears as a gray rounded square with a package icon - looks clean and intentional
6. Verify that other tabs (Brands, Groups, Sub-Groups, Variants, New Product) still show their proper images - changes were only made to CategoriesTab, so no regression expected

**Scope of Issue:**
| Tab/Module | Affected? | Reason |
|------------|-----------|--------|
| Categories Tab | ✅ Yes | Fixed - used raw `image_url` without `getStorageUrl()` and no Image `onError` fallback |
| Brands Tab | ❌ No | Brands have no image column in the table |
| Groups Tab | ❌ No | Groups have no image column in the table |
| Sub-Groups Tab | ❌ No | Sub-groups have no image column in the table |
| Variants Tab | ❌ No | Already uses `getStorageUrl(variant.image_url)` with proper handling |
| New Product View | ❌ No | Product editing uses different image flow with upload |

---

### LST-002: [Placeholder for next issue]

**Status:** 🔴 Open

---

### LST-003: [Placeholder for next issue]

**Status:** 🔴 Open

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

- All changes are **frontend-only** - no database schema changes, no migrations, no backend API changes
- The fix uses the existing `getStorageUrl()` utility that is already proven in VariantsTab
- The fallback behavior (showing grey Package icon) is already the default when `image_url` is null - we just extended it to also cover broken images
- If in the future category images are uploaded to the correct Supabase storage, `getStorageUrl()` will automatically resolve them to the correct URL