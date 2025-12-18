# Deployment Guide - Redemption History Fixes

## 🎯 Summary
All three issues have been fixed and committed to the `develop` branch on GitHub. The code changes are ready to deploy, but **database migrations must be run first**.

## ✅ What Was Fixed

### Issue 1: Admin Can't See Shop Redemptions ✅
- **Problem**: Admin login showed "No redemptions found"
- **Solution**: Updated `v_admin_redemptions` view to include `company_id` column that resolves to parent organization
- **Files**: `supabase/migrations/132_fix_admin_redemptions_view.sql`

### Issue 2: Point History Pagination ✅
- **Problem**: Requested pagination for Point History tab
- **Solution**: Already implemented! Shows 12 items initially with "Load more" button
- **Status**: No changes needed - feature already working

### Issue 3: User Redemptions Not Showing in History ✅
- **Problem**: Redemptions succeeded but didn't appear in user's history or admin view
- **Solution**: 
  - Fixed `company_id` logic in ShopCatalogPage.tsx (use shop's ID directly)
  - Added trigger to auto-generate redemption codes
- **Files**: 
  - `app/src/components/engagement/catalog/ShopCatalogPage.tsx`
  - `supabase/migrations/133_fix_redemption_code_generation.sql`

## 📦 Deployment Steps

### Step 1: Run Database Migrations ⚠️ REQUIRED FIRST

You can run migrations in two ways:

#### Option A: Use the Combined SQL File (Recommended)
```bash
# Connect to your database and run:
psql "your-database-connection-string" -f apply_redemption_fixes.sql
```

#### Option B: Use Supabase Dashboard
1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy and paste the contents of `apply_redemption_fixes.sql`
4. Click **Run**

### Step 2: Deploy Application Code

The code changes are already pushed to the `develop` branch. Deploy using your normal process:

```bash
# If using Vercel (from develop branch)
vercel --prod

# Or merge to main and deploy
git checkout main
git merge develop
git push origin main
```

### Step 3: Verify the Fixes

After deployment, test each issue:

**Test 1: Admin Redemption History**
1. Login as admin user
2. Go to: Consumer Engagement → Catalog → Admin View
3. Click on "Redemption History" tab
4. ✅ Should see all redemptions from all shops (including shop@dev.com's redemptions)

**Test 2: Point History Pagination** 
1. Login as shop user
2. Go to: Rewards → Point History tab
3. ✅ Should see 12 items with "Load more history" button if more than 12 records

**Test 3: User Redemption in History**
1. Login as shop user (e.g., shop@dev.com)
2. Go to Rewards catalog
3. Redeem a reward
4. Check "History" tab
5. ✅ Redemption should appear immediately with redemption code (RED-XXXXXXXX)
6. Login as admin and verify it appears in admin redemption history
7. ✅ Admin should see the redemption with "pending" status

## 🔍 What Changed

### Database Changes
- **View**: `v_admin_redemptions` - Added `company_id` column for filtering
- **Trigger**: `generate_redemption_code()` - Auto-generates codes for new redemptions
- **Backfill**: All existing redemptions without codes now have codes

### Application Changes
- **ShopCatalogPage.tsx** (line 323): Changed from `parent_org_id || id` to just `shopOrgId`

## 📝 Important Notes

1. **Migration Order**: The migrations are numbered 132 and 133, so they'll run in the correct order
2. **Existing Data**: Migration 133 will backfill redemption codes for all existing redemptions
3. **No Breaking Changes**: All changes are backward compatible
4. **Pagination**: Issue #2 required no changes - feature already existed

## 🚨 Troubleshooting

If admin still can't see redemptions after deployment:
```sql
-- Run this query to check if the view is working:
SELECT company_id, shop_id, shop_name, reward_name, redemption_code, redeemed_at
FROM v_admin_redemptions
ORDER BY redeemed_at DESC
LIMIT 10;
```

If redemption codes are missing:
```sql
-- Check if the trigger is working:
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'generate_redemption_code';

-- Manually backfill if needed:
UPDATE points_transactions
SET redemption_code = 'RED-' || UPPER(SUBSTRING(id::TEXT FROM 1 FOR 8))
WHERE transaction_type = 'redeem' 
AND (redemption_code IS NULL OR redemption_code = '');
```

## 📧 Support

If you encounter any issues during deployment, check:
1. The `REDEMPTION_AND_HISTORY_FIXES.md` file for detailed technical documentation
2. The migration SQL files for comments and verification queries
3. The git commit: `8780859` for all changes

---

**Commit**: 8780859  
**Branch**: develop  
**Date**: December 19, 2025  
**Status**: ✅ Ready to Deploy
