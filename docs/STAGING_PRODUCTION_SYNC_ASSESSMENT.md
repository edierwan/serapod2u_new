# Staging ↔ Production Sync Assessment

**Date**: 18 April 2026  
**Branch**: `staging` (b45feac + pending account-type label commit)  
**Production branch**: `main` (e059a58)  
**Preprod branch**: `origin/preprod` (edc23ea)

---

## A. Executive Summary

**Staging and production are NOT aligned.** Staging has **30 commits** ahead of `main` spanning major feature work (shop requests, profile completion, RoadTour fixes, dual-claim, consumer lane). Production (`main`) has **6 commits** not in staging (already superseded — same work was re-done/cherry-picked into staging's lineage).

**Key risk**: 3 migrations exist in staging code but only 1 is applied to staging DB. None are applied to production DB. The `shop_requests` table exists in staging DB but not production. Production has the same core schema (`users.consumer_claim_confirmed_at`, `can_be_reference`, RoadTour tables) so most code changes are safe.

**Bottom line**: Code can be merged to production after applying 1 migration. The bulk of the risk is the `shop_requests` feature and marketing daily reporting — both are new features that won't break existing flows if tables are missing (they'll just 404/error on those specific admin features).

---

## B. Confirmed Differences

### B1. Commits in staging NOT in main (30 commits)

| Commit | Description | Risk Area |
|--------|-------------|-----------|
| b45feac | Remove product dual-claim modal from RoadTour | RoadTour |
| 6fa1995 | RoadTour auto-resumes claim after profile save | RoadTour |
| a97233d | SHOP_REQUIRED gate uses real field-specific message | RoadTour |
| 4c23d0a | RoadTour profile-completion message dynamic | RoadTour |
| 4a0f6c7 | Consumer lane bypasses shop/reference requirement | Dual-claim |
| 53d2f6c | Dual-claim already-collected messages user-friendly | Dual-claim |
| 786a26d | RoadTour duplicate message + analytics consumer name | RoadTour |
| 19fb523 | RoadTour resume after profile save calls RoadTour API | RoadTour |
| a256ccd | Restore interrupted-then-resume collect flow | Profile flow |
| d16ac03 | Header shows user name prominently | UI |
| adf3718 | Replace shop request-for-approval with direct create | Shop requests |
| 0c31ea6 | Enforce profile completeness gating | Profile |
| b7df98c | ShopRequestDialog crash fix | Shop requests |
| 59f66c1 | Align shop requests and reference save | Shop requests |
| c917ad9 | Fix shop request selectors and reference matching | Shop requests |
| b43f2f8 | Add shared trusted points resolver | Points |
| 411f774 | Retry staging deploy for premium validation | Deploy |
| 9819875 | Validate premium profile links | Profile |
| 4d5aee9 | Clarify legacy reference warnings | UI |
| a392e4f | Fix call-name and linked shop display | UI |
| edc23ea | Unified activity tracking, consumer badge, QR activity | Activity |
| c5c8398 | Fix Coolify app build context for phones | Build |
| 0ea96da | Harden phone normalization end to end | Phone |
| 6b8e631 | Update user management reference column | Admin |
| dbaa0ce | Fix internal cron worker redirects | Infra |
| f6347a3 | Align claim lanes and add shop requests | Core |
| cbb1325 | Limit roadtour celebration modal | RoadTour |
| a6ddcf4 | Fix collect points profile prompt | Profile |
| edbc7c2 | Fix empty UUIDs in marketing campaigns | Marketing |
| 3c738c1 | Fix WhatsApp ingest auth and middleware access | WhatsApp |

### B2. Commits in main NOT in staging (6 commits — superseded)

| Commit | Description | Notes |
|--------|-------------|-------|
| e059a58 | Align claim lanes and add shop requests | Superseded by f6347a3 in staging |
| 1011fb5 | Fix collect points profile prompt | Superseded by a6ddcf4 |
| 7f6c9c3 | Fix Coolify app build context for phones | Superseded by c5c8398 |
| 10dba29 | Harden phone normalization end to end | Superseded by 0ea96da |
| 0bef17e | Fix internal cron worker redirects | Superseded by dbaa0ce |
| 2334a1c | Enhance consumer analytics reporting | Superseded by edc23ea |

These are the same logical changes, just different commit SHAs (staging was rebased/re-applied). **No actual code is lost.**

### B3. Uncommitted Local Changes (not in staging yet)

| File | Change | Status |
|------|--------|--------|
| `PremiumLoyaltyTemplate.tsx` | Account-type label in header (this session) | **Will commit now** |
| `check-collection-status/route.ts` | Use resolveTrustedPointsBalance for consumer balance | **Review needed** |
| `user/profile/route.ts` | Indentation fix only (no logic change) | Low risk |

### B4. Files Changed: staging vs main (57 files, ~6,883 insertions / 3,069 deletions)

**High-impact changed modules:**
- `PremiumLoyaltyTemplate.tsx` — Massive: header, dual-claim, consumer lane, RoadTour resume, profile completion
- `roadtour/claim-reward/route.ts` — RoadTour: duplicate msg, consumer bypass, field-specific messages, no dual-claim
- `collect-points/route.ts` + `collect-points-auth/route.ts` — Dual-claim messages, consumer lane bypass
- `profile-completion.ts` — Consumer lane bypass, dynamic messages
- `point-claim-settings.ts` — Lane experience resolver
- `profile-link-validation.ts` — Reference/shop link validation
- `qr-resolver.ts` — Trusted points resolver
- `UserManagementNew.tsx` — Consumer Verified filter
- `RoadtourAnalyticsView.tsx` — Consumer name in recent scans
- `RoadtourScanPage.tsx` — Dynamic profile message
- `shop-requests/*` — New shop create/request flow (new feature)
- `phone-core.ts`, `shared/phone/*` — Phone normalization hardening
- `baileys-gateway/*` — WhatsApp gateway fixes

---

## C. Behavior Differences

| Feature | Staging | Production | Risk |
|---------|---------|------------|------|
| **RoadTour dual-claim modal** | Removed — RoadTour has its own flow | Shows product "Confirm Consumer Lane" modal | **Medium** — prod users may see wrong modal |
| **RoadTour profile message** | Dynamic field-specific (**shop** / **reference**) | Generic "shop and reference" always | Low |
| **RoadTour resume after save** | Auto-resumes claim after profile update | Must manually go Home + click again | **Medium** |
| **Consumer lane bypass** | Consumer-confirmed users skip shop/ref check | All users blocked by shop/ref | **Medium** |
| **Dual-claim messages** | User-friendly with name | "Collected by shop staff lane" | Low |
| **Header display** | User name + account type label | User name + shop name (shop only) | Low |
| **Shop requests** | Direct create flow (no approval) | Request-for-approval flow | Low — new feature |
| **Phone normalization** | Hardened E164 + samePhone | Older normalization | Low |
| **User management** | Consumer Verified filter | No consumer filter | Low |
| **RoadTour analytics** | Shows consumer name + phone | Phone only | Low |
| **Marketing campaigns** | Fixed empty UUIDs | May have empty UUID issues | Low |

---

## D. DB / Migration Differences

### D1. Schema Comparison

| Element | Staging DB | Production DB | Preprod DB |
|---------|-----------|---------------|------------|
| `users.consumer_claim_confirmed_at` | ✅ | ✅ | ✅ |
| `users.can_be_reference` | ✅ | ✅ | ✅ |
| `users.last_login_at` | ✅ | ✅ | ✅ |
| `shop_requests` table | ✅ | ❌ | ❌ |
| `shop_request_notification_logs` table | ✅ | ❌ | ❌ |
| `validate_roadtour_qr_token` RPC | ✅ | ✅ | ✅ |
| `get_email_by_phone` RPC | ✅ | ✅ | ✅ |

### D2. Migrations in Code (staging branch) NOT Applied to Production

| Migration | Applied Staging | Applied Prod | Applied Preprod | Required for Code? |
|-----------|----------------|-------------|-----------------|-------------------|
| `20260415_marketing_daily_reporting.sql` | ❌ (not applied) | ❌ | ❌ | Only for marketing daily reporting view (optional) |
| `20260415_marketing_daily_reporting_inbound.sql` | ❌ (not applied) | ❌ | ❌ | Only for inbound message reporting (optional) |
| `20260417_shop_request_masterdata_alignment.sql` | ✅ (shop_requests exists) | ❌ | ❌ | **Required** if shop create feature is used |

### D3. Risk Assessment

- **Core RoadTour / claim / profile features**: All required columns (`consumer_claim_confirmed_at`, `can_be_reference`, RoadTour tables) exist in **all 3 databases**. No migration needed for core flows.
- **Shop requests**: `shop_requests` and `shop_request_notification_logs` tables must be created in production before the shop create feature works. The base `shop_requests` table create migration is NOT in the `supabase/migrations/` folder — it was applied directly. Only the column-add migration `20260417` is tracked.
- **Marketing daily reporting**: Views not created in any DB. Feature will error if accessed but won't break other flows.

---

## E. Environment / Config Differences

| Setting | Local (.env.local) | Staging (container) | Production (container) |
|---------|-------------------|---------------------|----------------------|
| Supabase URL | `sb-stg-serapod.getouch.co` | Internal `http://kong:8000` | Internal `http://kong:8000` |
| Supabase Public URL | N/A | N/A | `supabase-prd-serapod.getouch.cloud` |
| App URL | `localhost:3000` | `stg.serapod2u.com` | `serapod2u.com` (assumed) |
| NODE_ENV | development | production | production |
| DB Pool | Points to preprod `100.84.14.93:6543` | N/A | N/A |
| Supabase keys | Staging keys | **Production keys** ⚠️ | Production keys |

**⚠️ Note**: The staging container is using **production Supabase keys** (`SUPABASE_PUBLIC_URL=supabase-prd-serapod.getouch.cloud`). This means staging app may be reading/writing to the **production database**. This needs verification — it could mean staging and production share the same DB, or the env vars may be mislabeled.

**Local env** points to staging Supabase (`sb-stg-serapod.getouch.co`) with staging keys, and DATABASE_POOL_URL points to preprod server. This is expected for local development.

---

## F. Production Readiness Risks

### BLOCKING before production

| # | Risk | Impact | Resolution |
|---|------|--------|------------|
| 1 | **⚠️ Verify staging Supabase target** | Staging container has `SUPABASE_PUBLIC_URL=supabase-prd-serapod.getouch.cloud` — may be hitting prod DB | Check Coolify env vars for staging app; confirm whether staging has its own DB or shares prod |
| 2 | **Shop requests migration** | `shop_requests` table doesn't exist in prod. Shop create flow will fail. | Apply migration OR ensure feature is admin-only and won't be accessed until ready |

### Medium risk

| # | Risk | Impact | Resolution |
|---|------|--------|------------|
| 3 | Marketing daily reporting migrations not applied | Marketing reporting features won't work | Apply migrations when marketing reporting is ready to launch |
| 4 | Uncommitted `check-collection-status` change | Uses `resolveTrustedPointsBalance` — needs review | Review and either commit or discard |
| 5 | Branch divergence (staging rebased from main) | Cannot fast-forward merge staging→main | Will need `git merge staging` into main (or force-push) |

### Low risk / Informational

| # | Risk | Notes |
|---|------|-------|
| 6 | Phone normalization hardening | Improved but backward-compatible |
| 7 | WhatsApp gateway changes | Bug fixes, no breaking changes |
| 8 | moltbot package-lock churn | Large diff but just dependency resolution |

---

## G. Recommended Next Actions

### Step 1: Verify Staging DB Target (URGENT)
```bash
# On VPS, check if staging app has its own Supabase or shares prod
ssh deploy@72.62.253.182
# Check staging container's actual Supabase URL used at runtime
docker exec <staging-app-container> printenv | grep SUPABASE
```
If staging is using prod DB, all staging testing has been against production data. This must be confirmed before any merge.

### Step 2: Apply Shop Requests Migration to Production
```sql
-- Run on production DB (only if shop create feature should be available)
-- First create base table if needed, then run:
-- supabase/migrations/20260417_shop_request_masterdata_alignment.sql
```

### Step 3: Apply Marketing Reporting Migrations (Optional)
```sql
-- Run on production DB when marketing reporting is needed:
-- supabase/migrations/20260415_marketing_daily_reporting.sql
-- supabase/migrations/20260415_marketing_daily_reporting_inbound.sql
```

### Step 4: Review Uncommitted Changes
- `check-collection-status/route.ts`: Review trusted balance resolver change
- `user/profile/route.ts`: Indentation only — safe to commit or discard

### Step 5: Merge staging → main
```bash
git checkout main
git merge staging
# Resolve any conflicts (likely minimal — main changes are superseded)
git push origin main
```

### Step 6: Sync preprod
```bash
git checkout preprod
git merge staging
git push origin preprod
```

### Step 7: Post-merge Verification
- Verify production deployment succeeds
- Test RoadTour flow end-to-end on production
- Test product QR dual-claim on production
- Test shop create flow (after migration)
- Verify consumer lane bypass works

---

## H. Tested Features (Staging QA Completed)

The following features have been tested on staging in this QA session:

| Feature | Status | Commits |
|---------|--------|---------|
| RoadTour resume after profile save | ✅ Tested | 19fb523, 6fa1995 |
| RoadTour duplicate message wording | ✅ Tested | 786a26d |
| RoadTour analytics consumer name | ✅ Tested | 786a26d |
| Dual-claim already-collected messages | ✅ Tested | 53d2f6c |
| Consumer lane bypass | ✅ Tested | 4a0f6c7 |
| Consumer Verified filter | ✅ Tested | 4a0f6c7 |
| Dynamic profile-completion messages | ✅ Tested | 4c23d0a, a97233d |
| RoadTour no dual-claim modal | ✅ Tested | b45feac |
| Header user name display | ✅ Tested | d16ac03 |
| Profile completion gating | ✅ Tested | 0c31ea6 |
