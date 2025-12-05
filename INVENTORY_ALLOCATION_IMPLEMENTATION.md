# Inventory Allocation Implementation for D2H and S2D Orders

## Overview

This document describes the inventory allocation system implemented for D2H
(Distributor to HQ) and S2D (Shop to Distributor) orders. The system ensures
proper inventory tracking by reserving stock when orders are created and
releasing it when orders are approved or cancelled.

## Business Logic

### Inventory Columns

The `product_inventory` table has three key columns:

1. **On Hand (`quantity_on_hand`)**: Physical stock available in the warehouse
2. **Allocated (`quantity_allocated`)**: Stock reserved for submitted orders
   (not yet shipped)
3. **Available (`quantity_available`)**: Stock that can be used for new orders
   - **Formula**: `Available = On Hand - Allocated`
   - This is a **generated column** automatically calculated by the database

### Order Flow

#### 1️⃣ Initial State (No Orders)

```
On Hand = 100
Allocated = 0
Available = 100
```

#### 2️⃣ User Creates D2H/S2D Order (10 units)

When order is **created and submitted**:

```
On Hand = 100      ✅ (physical stock unchanged, goods still in warehouse)
Allocated = 10     ✅ (10 units reserved for this order)
Available = 90     ✅ (100 - 10)
```

- System uses `Available` to check if sufficient stock exists
- Only **available quantity** can be used for new orders

#### 3️⃣ Order is Approved (Goods Shipped)

When order is **approved**:

```
On Hand = 90       ✅ (10 units shipped out)
Allocated = 0      ✅ (reservation released)
Available = 90     ✅ (90 - 0)
```

- Stock is deducted from seller's warehouse
- Stock is added to buyer's inventory
- Allocation is released

#### 4️⃣ Order is Cancelled (Before Approval)

If order is **cancelled** before shipping:

```
On Hand = 100      ✅ (physical stock unchanged)
Allocated = 0      ✅ (reservation released)
Available = 100    ✅ (back to full availability)
```

## Technical Implementation

### Database Changes

#### Migration File

**File**: `supabase/migrations/086_add_inventory_allocation_functions.sql`

This migration creates three key functions:

1. **`allocate_inventory_for_order(p_order_id)`**
   - Called when D2H/S2D order is created
   - Increases `quantity_allocated`
   - Validates sufficient available stock
   - Logs allocation in stock movements

2. **`release_allocation_for_order(p_order_id)`**
   - Called when order is cancelled
   - Decreases `quantity_allocated`
   - Logs deallocation in stock movements

3. **`orders_approve(p_order_id)` (updated)**
   - Releases allocation
   - Deducts from seller's `quantity_on_hand`
   - Adds to buyer's `quantity_on_hand`
   - Logs both seller and buyer movements

### Frontend Changes

#### D2H Orders

**File**: `app/src/components/orders/DistributorOrderView.tsx`

After order is submitted, allocate inventory:

```typescript
// Allocate inventory for the order (reserves stock)
const { error: allocateError } = await supabase
  .rpc("allocate_inventory_for_order", { p_order_id: order.id });

if (allocateError) {
  // Rollback order creation if allocation fails
  await supabase.from("orders").delete().eq("id", order.id);
  throw new Error(`Failed to allocate inventory: ${allocateError.message}`);
}
```

#### S2D Orders

**File**: `app/src/components/orders/ShopOrderView.tsx`

Same allocation logic as D2H orders.

#### Order Deletion

**File**: `app/src/lib/utils/deletionValidation.ts`

Before deleting a submitted D2H/S2D order, release allocation:

```typescript
if (
  orderData && ["D2H", "S2D"].includes(orderData.order_type) &&
  orderData.status === "submitted"
) {
  await supabase.rpc("release_allocation_for_order", { p_order_id: orderId });
}
```

## Stock Movement Tracking

All allocation changes are logged in `stock_movements` table:

### Allocation Movement

```sql
movement_type: 'allocation'
reference_type: 'order'
quantity_change: +10 (positive, tracking allocated amount)
notes: 'Inventory allocated for order'
```

### Deallocation Movement

```sql
movement_type: 'deallocation'
reference_type: 'order'
quantity_change: -10 (negative, tracking released amount)
notes: 'Inventory allocation released'
```

### Order Fulfillment (Approval)

```sql
-- Seller side
movement_type: 'order_fulfillment'
quantity_change: -10 (deducted from seller)
notes: 'Order approved - stock shipped to buyer'

-- Buyer side
movement_type: 'transfer_in'
quantity_change: +10 (added to buyer)
notes: 'Order approved - stock received from seller'
```

## Validation Rules

### Database Constraint

```sql
CONSTRAINT valid_quantities CHECK (
  (quantity_on_hand >= 0) AND 
  (quantity_allocated >= 0) AND 
  (quantity_allocated <= quantity_on_hand)
)
```

This ensures:

- ✅ Can never allocate more than physical stock
- ✅ Quantities cannot be negative
- ✅ Allocated always reflects reserved stock

### Order Creation Validation

```typescript
// Frontend checks available quantity
if (newQty > variant.available_qty) {
  toast({
    title: "Insufficient Stock",
    description: `Only ${variant.available_qty} units available in inventory`,
    variant: "destructive",
  });
  return;
}
```

### Allocation Function Validation

```sql
-- Database function checks available stock
IF v_available < v_item.qty THEN
    RAISE EXCEPTION 'Insufficient available stock for variant %. Available: %, Requested: %', 
        v_item.variant_id, v_available, v_item.qty;
END IF;
```

## Order Types and Allocation

| Order Type               | Allocates Inventory? | When?                                |
| ------------------------ | -------------------- | ------------------------------------ |
| H2M (HQ → Manufacturer)  | ❌ No                | N/A                                  |
| D2H (Distributor → HQ)   | ✅ Yes               | On order creation (submitted status) |
| S2D (Shop → Distributor) | ✅ Yes               | On order creation (submitted status) |

## Benefits

1. **Accurate Availability**: Users see real-time available stock, accounting
   for pending orders
2. **Prevent Overselling**: Cannot create orders for stock that's already
   allocated
3. **Clear Audit Trail**: All allocation changes are logged in stock movements
4. **Proper Workflow**: Stock is reserved → shipped → released in proper
   sequence
5. **Consistent Formula**: `Available = On Hand - Allocated` always holds true

## Testing Checklist

### D2H Order Flow

- [ ] Create D2H order with 10 units → Allocated increases by 10, Available
      decreases by 10
- [ ] Approve D2H order → On Hand decreases by 10, Allocated decreases by 10,
      Available stays same
- [ ] Check buyer inventory → On Hand increases by 10

### S2D Order Flow

- [ ] Create S2D order with 5 units → Allocated increases by 5, Available
      decreases by 5
- [ ] Approve S2D order → On Hand decreases by 5, Allocated decreases by 5,
      Available stays same
- [ ] Check buyer inventory → On Hand increases by 5

### Order Cancellation

- [ ] Create order with 10 units → Allocated = 10
- [ ] Delete order → Allocated returns to 0, Available increases by 10

### Edge Cases

- [ ] Try to create order with qty > available → Should be blocked
- [ ] Create multiple orders → Allocated should sum up correctly
- [ ] Try to allocate more than on_hand → Database constraint should prevent

## Files Modified

### Database

- ✅ `supabase/migrations/086_add_inventory_allocation_functions.sql` (new)

### Frontend

- ✅ `app/src/components/orders/DistributorOrderView.tsx` (modified)
- ✅ `app/src/components/orders/ShopOrderView.tsx` (modified)
- ✅ `app/src/lib/utils/deletionValidation.ts` (modified)

### Documentation

- ✅ `INVENTORY_ALLOCATION_IMPLEMENTATION.md` (this file)

## Database Schema Reference

```sql
CREATE TABLE product_inventory (
    quantity_on_hand integer DEFAULT 0,
    quantity_allocated integer DEFAULT 0,
    quantity_available integer GENERATED ALWAYS AS 
        (quantity_on_hand - quantity_allocated) STORED,
    CONSTRAINT valid_quantities CHECK (
        (quantity_on_hand >= 0) AND 
        (quantity_allocated >= 0) AND 
        (quantity_allocated <= quantity_on_hand)
    )
);
```

## API Reference

### Allocate Inventory

```sql
SELECT allocate_inventory_for_order('{order-uuid}');
```

- Increases `quantity_allocated` for all order items
- Validates sufficient available stock
- Logs allocation movements

### Release Allocation

```sql
SELECT release_allocation_for_order('{order-uuid}');
```

- Decreases `quantity_allocated` for all order items
- Logs deallocation movements

### Approve Order (handles allocation automatically)

```sql
SELECT orders_approve('{order-uuid}');
```

- Releases allocation
- Deducts seller inventory
- Adds buyer inventory
- Logs all movements

## Future Enhancements

### Potential Improvements

1. **Allocation Expiry**: Auto-release allocations after X days if order not
   approved
2. **Partial Allocation**: Allow partial fulfillment of orders
3. **Allocation Dashboard**: View all active allocations across warehouse
4. **Allocation Alerts**: Notify when available stock is low due to allocations

### Not Implemented (Out of Scope)

- H2M orders do not use allocation (manufacturer produce to order)
- No allocation for draft orders (only submitted orders)
- No allocation for non-order movements (transfers, adjustments, etc.)

## Deployment Steps

### 1. Apply Database Migration

```bash
# Apply the migration to your Supabase instance
# Migration file: supabase/migrations/086_add_inventory_allocation_functions.sql
```

### 2. Regenerate TypeScript Types (Optional)

```bash
# Update TypeScript types to include new RPC functions
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > app/src/types/database.ts
```

Note: The TypeScript compiler may show errors for `allocate_inventory_for_order`
and `release_allocation_for_order` until types are regenerated. The functions
will work correctly at runtime once the migration is applied.

### 3. Test the Implementation

Follow the testing checklist above to verify all flows work correctly.

## Support

For questions or issues:

1. Check stock movements table for allocation/deallocation logs
2. Verify `quantity_available` is calculated correctly (on_hand - allocated)
3. Ensure database constraint is not violated
4. Check frontend validation is using `available_qty` not `on_hand`

## Known Issues

### TypeScript Compilation Warnings

- **Issue**: TypeScript may show type errors for new RPC functions
- **Impact**: No runtime impact, only compilation warnings
- **Solution**: Regenerate types after applying migration (see Deployment Steps)

---

**Implementation Date**: December 5, 2025\
**Status**: ✅ Complete and Ready for Testing
