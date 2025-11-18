# Balance Payment Request Trigger Change

## Overview

Changed the balance payment request trigger from **warehouse receive** to
**manufacturer "Production Complete"** button click.

## Previous Behavior

- Balance payment request (50-70% of order value) was automatically created when
  warehouse scanned the master QR code
- Trigger function: `trg_on_purchase_receive_create_balance_request()` in
  `current_schema.sql`
- Triggered on `warehouse_receive` stock movement

## New Behavior

- Balance payment request is created when manufacturer clicks **"Production
  Complete - Ready to Ship"** button
- Happens after all cases in a batch are packed (100% master code progress)
- Dynamic percentage based on order's `payment_terms.balance_pct` field (e.g.,
  30%, 50%, 70%)
- Toast notification shows the balance percentage when payment request is
  created
- Informational text below button indicates balance payment will be requested

## Implementation Details

### 1. Backend Changes

#### API Endpoint: `/api/manufacturer/complete-production/route.ts`

```typescript
// After marking batch as completed
const { data: balancePayment, error: balancePaymentError } = await supabase.rpc(
    "fn_create_balance_payment_request",
    { p_order_id: orderInfo.id },
);

return NextResponse.json({
    success: true,
    // ... other fields
    balance_payment_created: !!balancePayment,
    balance_document_no: balancePayment || null,
});
```

#### Database Trigger: `trg_on_purchase_receive_create_balance_request()`

**File:** `supabase/schemas/current_schema.sql` (lines 5620-5670)

**Status:** DISABLED

The core logic that created balance payment requests on warehouse receive has
been commented out:

```sql
-- DISABLED: Balance payment request is now triggered by manufacturer "Production Complete" button
-- Simply return without creating balance payment request
RETURN NEW;
```

**Reason:** Balance payment should be requested when production is complete, not
when warehouse receives goods. This gives better visibility and control to the
manufacturer.

### 2. Frontend Changes

#### Component: `ManufacturerScanViewV2.tsx`

##### Orders Query (line ~577)

Added `payment_terms` to the SELECT query:

```typescript
.select(`
  id,
  order_no,
  status,
  created_at,
  payment_terms,  // <-- ADDED
  organizations!orders_buyer_org_id_fkey (
    org_name
  ),
  qr_batches (
    id
  )
`)
```

##### Production Complete Handler (line ~1940)

Enhanced `handleCompleteProduction` to show dynamic balance percentage:

```typescript
// Calculate balance percentage from payment terms
const selectedOrderData = orders.find((o) => o.id === selectedOrder);
const balancePct = selectedOrderData?.payment_terms?.balance_pct || 0.5;
const balancePercentage = Math.round(balancePct * 100);

// Show success message with balance payment info
const balanceMessage = result.balance_payment_created
    ? ` Balance payment request (${balancePercentage}%) has been sent to admin for approval.`
    : "";

toast({
    title: "Production Complete! 🎉",
    description:
        `Batch ${currentBatchProgress.batch_code} is now ready for warehouse shipment. ${result.packed_master_codes} of ${result.total_master_codes} cases packed.${balanceMessage}`,
});
```

##### UI Display (line ~2910)

Added informational text below the "Production Complete" button:

```tsx
{/* Balance Payment Info */}
{
    currentBatchProgress?.batch_status !== "completed" &&
        masterPercent === 100 && (() => {
            const selectedOrderData = orders.find((o) =>
                o.id === selectedOrder
            );
            const balancePct = selectedOrderData?.payment_terms?.balance_pct ||
                0.5;
            const balancePercentage = Math.round(balancePct * 100);
            return (
                <p className="text-xs text-gray-600 mt-2 text-right">
                    💡 <strong>Note:</strong>{" "}
                    Balance payment request ({balancePercentage}%) will be sent
                    to admin when production is marked complete.
                </p>
            );
        })();
}
```

## Payment Terms Structure

Orders have a `payment_terms` JSONB field:

```json
{
    "deposit_pct": 0.3,
    "balance_pct": 0.7,
    "balance_trigger": "on_first_receive"
}
```

- `deposit_pct`: Percentage paid upfront (e.g., 0.3 = 30%)
- `balance_pct`: Percentage paid as balance (e.g., 0.7 = 70%)
- `balance_trigger`: When to request balance (legacy field, now ignored)

**Default:** 50/50 split (0.5 deposit, 0.5 balance)

## User Experience

### Before Production Complete

When batch is 100% packed, manufacturer sees:

```
[Production Complete - Ready to Ship] button
💡 Note: Balance payment request (70%) will be sent to admin when production is marked complete.
```

### After Production Complete

Toast notification appears:

```
🎉 Production Complete!
Batch MFG-001-B1 is now ready for warehouse shipment. 50 of 50 cases packed.
Balance payment request (70%) has been sent to admin for approval.
```

## Database Function

**Function:** `fn_create_balance_payment_request(p_order_id uuid)`

- Creates a `PAYMENT_REQUEST` document
- Sets reason to `BALANCE_50_AFTER_RECEIVE`
- Calculates amount based on `payment_terms.balance_pct`
- Links to buyer/seller organizations
- Status: `pending` (awaiting admin approval)

## Migration Notes

### For Existing Orders

- Orders already in warehouse with no balance payment will NOT retroactively
  create one
- Only new production completions will trigger balance payment requests
- If needed, admin can manually create balance payment requests via database
  function

### Database Schema

No schema changes required. Using existing:

- `orders.payment_terms` JSONB field
- `documents` table for PAYMENT_REQUEST
- `fn_create_balance_payment_request()` function

### Rollback Procedure

If needed to revert to warehouse-triggered balance payments:

1. Re-enable the trigger logic in `current_schema.sql`:
   ```sql
   -- Uncomment lines 5620-5670 in trg_on_purchase_receive_create_balance_request()
   ```

2. Remove balance payment creation from `complete-production/route.ts`:
   ```typescript
   // Comment out the RPC call to fn_create_balance_payment_request
   ```

3. Remove UI text from `ManufacturerScanViewV2.tsx`

## Testing Checklist

- [ ] Create order with 30/70 payment terms
- [ ] Pack all cases in batch (100% progress)
- [ ] Click "Production Complete - Ready to Ship"
- [ ] Verify toast shows "Balance payment request (70%)"
- [ ] Check database for new PAYMENT_REQUEST document
- [ ] Verify warehouse receive does NOT create duplicate balance payment
- [ ] Test with 50/50 payment terms
- [ ] Test with null payment_terms (should default to 50%)

## Benefits

1. **Better Timing:** Balance payment requested when production is ready, not
   after shipping
2. **Manufacturer Control:** MFG explicitly triggers the payment request
3. **Clear Communication:** Dynamic percentage shown to manufacturer before
   clicking
4. **Prevents Surprises:** No automatic payment requests during warehouse
   operations
5. **Flexible:** Supports any payment split (30/70, 50/50, etc.)

## Related Files

- `/api/manufacturer/complete-production/route.ts` - Backend API
- `ManufacturerScanViewV2.tsx` - Frontend UI
- `supabase/schemas/current_schema.sql` - Database trigger (disabled)
- `orders` table - payment_terms JSONB field
- `documents` table - PAYMENT_REQUEST records
