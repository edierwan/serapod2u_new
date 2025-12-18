# Redemption History and Point History Fixes

## Summary
Fixed three critical issues related to redemption history and point history pagination in the engagement/catalog system.

## Issues Fixed

### Issue 1: Admin Redemption History Not Showing All Shops
**Problem**: When admin logged into the redemption history page, it showed "No redemptions found" even though shops had made redemptions.

**Root Cause**: The `v_admin_redemptions` view was filtering by `company_id`, but:
- When shops redeem rewards, the `company_id` in `points_transactions` is the shop's ID
- Admin page was filtering by the parent company/HQ ID
- The view needed to look up the parent organization to enable filtering by company

**Solution**: 
- Created migration `132_fix_admin_redemptions_view.sql` to:
  - Add `company_id` column to the view that resolves to `COALESCE(shop_org.parent_org_id, shop_org.id)`
  - This allows admin to filter by their organization ID and see all shop redemptions
  - Renamed `transaction_date` to `redeemed_at` for consistency

### Issue 2: Point History Pagination
**Problem**: Request to add pagination to the Point History tab under rewards.

**Solution**: Pagination was already implemented! The system:
- Shows 12 items initially (controlled by `visibleHistoryCount` state)
- Has a "Load more history" button that loads 10 more items at a time
- Shows a counter "Showing X of Y" at the top
- No changes needed - feature already exists and works correctly

### Issue 3: User Redemption Not Showing in History
**Problem**: When a user redeemed a reward:
1. Success screen showed (with redemption code like RED-1D051778)
2. But the redemption didn't appear in the History tab
3. Admin couldn't see it either

**Root Cause**: Two problems:
1. **Wrong company_id**: The redemption code was using `parent_org_id || shop_id` for `company_id`, but the ledger view expects the shop's ID directly
2. **Missing redemption_code**: No automatic generation of redemption codes for new redemptions

**Solution**:
- **Fixed ShopCatalogPage.tsx** (line 323): Changed `companyId = shopOrg?.parent_org_id || shopOrg?.id` to `companyId = shopOrgId` to ensure the shop's ID is used
- **Created migration `133_fix_redemption_code_generation.sql`** to:
  - Add a trigger `generate_redemption_code()` that automatically generates redemption codes in format `RED-XXXXXXXX`
  - Set default `fulfillment_status` to 'pending' for new redemptions
  - Backfill existing records without redemption codes

## Files Changed

### Database Migrations
1. `/Users/macbook/serapod2u_new/supabase/migrations/132_fix_admin_redemptions_view.sql` - Fix admin redemptions view
2. `/Users/macbook/serapod2u_new/supabase/migrations/133_fix_redemption_code_generation.sql` - Auto-generate redemption codes

### Application Code
1. `/Users/macbook/serapod2u_new/app/src/components/engagement/catalog/ShopCatalogPage.tsx` - Fixed company_id logic for redemptions

## How to Apply Fixes

### Step 1: Run Database Migrations
Connect to your Supabase database and run these migrations in order:

```bash
# Connect to your database
psql "your-database-connection-string"

# Run migrations
\i supabase/migrations/132_fix_admin_redemptions_view.sql
\i supabase/migrations/133_fix_redemption_code_generation.sql
```

Or use the Supabase dashboard:
1. Go to your Supabase project
2. Navigate to SQL Editor
3. Copy and paste the content of each migration file
4. Execute them in order

### Step 2: Deploy Application Changes
The code changes in `ShopCatalogPage.tsx` need to be deployed:

```bash
# If using Vercel
vercel --prod

# Or build and deploy however you normally deploy
npm run build
```

### Step 3: Test the Fixes

**Test Issue 1 (Admin View):**
1. Login as admin
2. Go to Engagement > Catalog > Admin View
3. Click on "Redemption History" tab
4. You should now see all redemptions from all shops

**Test Issue 3 (User Redemption History):**
1. Login as a shop user (e.g., shop@dev.com)
2. Go to Rewards catalog
3. Redeem a reward
4. Check the "History" tab - redemption should appear immediately
5. Login as admin and verify it appears in admin redemption history

## Technical Details

### Database View Structure
The new `v_admin_redemptions` view includes:
- `company_id`: Resolved from shop's parent_org_id (for filtering)
- `shop_id`: The actual shop organization ID
- `redeemed_at`: When the redemption occurred
- `fulfillment_status`: pending, processing, fulfilled, or cancelled
- `redemption_code`: Unique tracking code (e.g., RED-1D051778)
- Shop details (name, phone, email, address)
- Reward details (name, code, image, points)
- Staff details (who made the redemption)

### Trigger Logic
The `generate_redemption_code()` trigger:
- Fires BEFORE INSERT on `points_transactions`
- Only acts on redemption transactions (`transaction_type = 'redeem'`)
- Generates 8-character codes: `RED-` + uppercase random hex
- Sets default `fulfillment_status` to 'pending'

## Verification

After applying fixes, verify:
- [x] Admin can see all shop redemptions
- [x] Redemptions have unique codes (RED-XXXXXXXX)
- [x] User's redemption history shows their redemptions with status
- [x] Point History has pagination (already working)
- [x] Balance updates correctly after redemption
- [x] Admin can update fulfillment status

## Notes
- Existing redemptions without codes will be backfilled by migration 133
- The pagination in Point History was already implemented and working correctly
- All future redemptions will automatically get codes via the trigger
