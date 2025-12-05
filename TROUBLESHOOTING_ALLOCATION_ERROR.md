# Troubleshooting: Empty Allocation Error

## Problem

Getting error: `Error allocating inventory: {}` when creating D2H or S2D orders.

## Root Cause

The database migration hasn't been applied yet, so the
`allocate_inventory_for_order` function doesn't exist in your Supabase database.

## Solution

### Option 1: Using Supabase CLI (Recommended)

1. **Apply the migration**:
   ```bash
   cd /Users/macbook/serapod2u_new
   ./apply-allocation-migration.sh
   ```

   Or manually:
   ```bash
   supabase db push
   ```

2. **Verify the functions exist**:
   - Go to Supabase Dashboard → Database → Functions
   - Look for:
     - `allocate_inventory_for_order`
     - `release_allocation_for_order`
     - Updated `orders_approve`

### Option 2: Manual SQL Execution

1. **Open Supabase Dashboard** → SQL Editor

2. **Copy and paste the entire migration file**:
   - File: `supabase/migrations/086_add_inventory_allocation_functions.sql`
   - Click "Run"

3. **Verify execution**:
   ```sql
   -- Check if functions exist
   SELECT proname 
   FROM pg_proc 
   WHERE proname IN ('allocate_inventory_for_order', 'release_allocation_for_order');
   ```

### Option 3: Check Supabase Connection

If the migration exists but still getting the error:

1. **Check Supabase connection**:
   ```typescript
   // In your browser console (while on the app)
   const { data, error } = await supabase.rpc("allocate_inventory_for_order", {
       p_order_id: "test-uuid",
   });
   console.log("Function exists?", error === null ? "Yes" : "No");
   console.log("Error details:", error);
   ```

2. **Check RLS policies**:
   - The functions should be granted to both `authenticated` and `anon` roles
   - This is included in the migration

## After Applying Migration

### Test the Flow

1. **Create a D2H order**:
   - Select distributor
   - Add products (check available qty is shown)
   - Submit order
   - ✅ Should see: "Inventory allocated successfully"

2. **Check Inventory View**:
   - Navigate to Inventory → View Inventory
   - Find the products from your order
   - ✅ "Allocated" column should show the reserved quantity
   - ✅ "Available" should be reduced

3. **Approve the Order**:
   - Go to Orders list
   - Click "Approve" on the order
   - ✅ Seller's "On Hand" should decrease
   - ✅ Seller's "Allocated" should return to 0
   - ✅ Buyer's "On Hand" should increase

### Console Logs to Look For

**Success:**

```
✅ Inventory allocated successfully for order: ORD-DH-1225-01
```

**Error (before migration):**

```
Error allocating inventory: {}
Allocation error details: {}
```

**Error (after migration, if stock insufficient):**

```
Error allocating inventory: { 
  message: "Insufficient available stock for variant..."
}
```

## Common Issues

### Issue 1: Function Not Found

**Symptom**: Empty error object `{}` **Solution**: Apply the migration (see
above)

### Issue 2: Insufficient Stock

**Symptom**: Error message about insufficient available stock **Solution**:

- Check current inventory levels
- Ensure "Available" qty (not "On Hand") is sufficient
- Other pending orders may have allocated the stock

### Issue 3: Permission Denied

**Symptom**: Error about permissions **Solution**:

- Migration should grant to both `authenticated` and `anon`
- Re-run the grant statements:

```sql
GRANT EXECUTE ON FUNCTION public.allocate_inventory_for_order TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.release_allocation_for_order TO authenticated, anon;
```

### Issue 4: TypeScript Type Errors

**Symptom**: Red squiggly lines in VS Code **Impact**: None - it's just a
TypeScript warning **Solution** (optional): Regenerate types

```bash
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > app/src/types/database.ts
```

## Verify Everything Works

Run this SQL query to see allocation in action:

```sql
-- Before creating order
SELECT 
  pv.variant_name,
  pi.quantity_on_hand,
  pi.quantity_allocated,
  pi.quantity_available,
  o.org_name as warehouse
FROM product_inventory pi
JOIN product_variants pv ON pi.variant_id = pv.id
JOIN organizations o ON pi.organization_id = o.id
WHERE pv.variant_name ILIKE '%your-product%'
  AND o.org_type_code = 'WH';

-- Create order via UI

-- After creating order (should see allocated increase)
-- Run the same query

-- After approving order (should see on_hand decrease, allocated return to 0)
-- Run the same query
```

## Need Help?

1. Check the console logs for detailed error messages
2. Verify migration was applied: Check Supabase Dashboard → Database → Functions
3. Look at stock movements:
   `SELECT * FROM stock_movements WHERE movement_type IN ('allocation', 'deallocation') ORDER BY created_at DESC LIMIT 10;`

---

**Quick Fix**: Run `./apply-allocation-migration.sh` and try creating the order
again!
