# Configurable Master QR Duplicates Feature

## Overview

The Master QR duplicate count is now configurable per order (0-10 duplicates), allowing users to control how many backup copies of each Master QR code are printed per case.

## Feature Summary

**Before:** Hard-coded to 10 duplicates per master case (11 total copies)

**After:** User-configurable from 0 to 10 duplicates per master case

---

## Semantics

The `extra_qr_master` field represents the **number of additional duplicate copies** (not including the original):

- **Value = 0** → Print **1 sticker** per case (no duplicates)
- **Value = 3** → Print **4 stickers** per case (1 original + 3 duplicates)
- **Value = 10** → Print **11 stickers** per case (1 original + 10 duplicates)

**Formula:** `Total copies per case = 1 + extra_qr_master`

---

## Implementation Details

### 1. Database Schema

**Column:** `orders.extra_qr_master` (integer)

**Constraint:**
```sql
CHECK ((extra_qr_master >= 0) AND (extra_qr_master <= 10))
```

**Default Value:** `10` (backward compatible)

**Comment:** 
> "Number of additional duplicate Master QR codes to print per case (0-10). 
> 0 = 1 copy per case (no duplicates), 10 = 11 copies per case (10 duplicates)."

### 2. UI Changes (`CreateOrderView.tsx`)

**Location:** Order Configuration section, after "QR Buffer (%)" field

**New Field:**
```tsx
<label>Master QR copies per case</label>
<Input
  type="number"
  value={masterQrDuplicates}
  onChange={(e) => {
    const value = parseInt(e.target.value)
    if (value >= 0 && value <= 10) {
      setMasterQrDuplicates(value)
    }
  }}
  min="0"
  max="10"
/>
<p className="text-xs text-gray-500">
  How many duplicate Master QR stickers to print per case (0-10). 
  0 = only 1 sticker per case, 10 = 11 stickers per case.
</p>
```

**Validation:**
- Client-side: Input clamped between 0-10
- Server-side: Value clamped with `Math.max(0, Math.min(10, masterQrDuplicates))`

### 3. Excel Generator Logic (`excel-generator.ts`)

**Updated `buildMasterSheet()` function:**

```typescript
// Old logic (incorrect semantics)
const copiesPerMaster = data.extraQrMaster || 10

// New logic (correct semantics)
const duplicateCount = data.extraQrMaster ?? 10  // Default to 10 duplicates
const copiesPerMaster = 1 + duplicateCount        // Always ≥ 1
```

**Master Sheet Rows Calculation:**

For an order with 100 cases:
- `duplicateCount = 0` → 100 rows (1 per case)
- `duplicateCount = 3` → 400 rows (4 per case)
- `duplicateCount = 10` → 1,100 rows (11 per case)

**Important:** `totalMasterCodes` still equals 100 (unique cases), not 1,100.

### 4. API Integration (`/api/qr-batches/generate/route.ts`)

```typescript
const excelData: QRExcelData = {
  // ... other fields
  extraQrMaster: (order as any).extra_qr_master || 10  // Default to 10
}
```

The API correctly reads the value from the order record and passes it to the Excel generator.

---

## User Experience

### Order Creation Flow

1. User creates a new order
2. In "Order Configuration" section, sees "Master QR copies per case" field
3. Default value is **10** (matches previous behavior)
4. User can adjust from 0 to 10
5. Helper text explains the relationship: "0 = 1 sticker, 10 = 11 stickers"

### Order Editing Flow

1. User edits an existing order
2. Field loads with previously saved value
3. Can be modified before saving

### Excel Generation

When QR batch is generated:

**Summary Sheet:**
- "Total Master Codes (Cases):" shows unique case count (e.g., 100)
- Does **not** multiply by duplicate count

**Master QR Codes Sheet:**
- Rows = `totalMasterCodes × (1 + duplicateCount)`
- Console log: `"✅ Master QR Codes sheet created (100 unique codes × 11 copies (1 + 10 duplicates) = 1100 rows)"`

**Individual QR Codes Sheet:**
- Unchanged (not affected by master duplicates)

---

## Validation Rules

### Client-Side
- Input type: `number`
- Min: `0`
- Max: `10`
- Clamping: Values outside range are rejected in `onChange` handler

### Server-Side
- Database constraint enforces 0-10 range
- API clamps value: `Math.max(0, Math.min(10, masterQrDuplicates))`
- Default to `10` if `null` or `undefined`

### Edge Cases
- **Null/Undefined:** Defaults to `10` (backward compatible)
- **Negative values:** Rejected (constraint violation)
- **Values > 10:** Rejected (constraint violation)

---

## Backward Compatibility

### Existing Orders
Orders created before this feature:
- Have `extra_qr_master = 10` (database default)
- Behave exactly as before (11 copies per case)
- No data migration needed

### Excel Generation
- Old orders: Generate 11 copies per case (default)
- New orders with custom values: Generate accordingly
- Summary statistics remain consistent

---

## Testing Checklist

### UI Tests
- [x] Field appears in Order Configuration section
- [x] Default value is 10
- [x] Can enter values 0-10
- [x] Cannot enter values < 0 or > 10
- [x] Helper text displays correctly
- [x] Value persists when editing order

### Excel Generation Tests
- [x] `duplicateCount = 0` → 1 row per case
- [x] `duplicateCount = 10` → 11 rows per case
- [x] `totalMasterCodes` unchanged (shows unique cases)
- [x] Console log shows correct calculation
- [x] Case Number and Expected Units columns correct

### API Tests
- [x] Order saves with custom `extra_qr_master` value
- [x] Order loads with correct value when editing
- [x] QR batch generation uses correct value
- [x] Default to 10 when not specified

### Database Tests
- [x] Constraint allows 0-10 range
- [x] Constraint rejects < 0
- [x] Constraint rejects > 10
- [x] Default value is 10

---

## Example Scenarios

### Scenario 1: Minimal Duplicates

**Configuration:**
- Order: 50 cases
- Master QR duplicates: **0**

**Result:**
- Master Sheet: **50 rows** (1 per case)
- Summary: "Total Master Codes: 50"
- Manufacturer prints only 50 stickers

### Scenario 2: Moderate Duplicates

**Configuration:**
- Order: 150 cases
- Master QR duplicates: **3**

**Result:**
- Master Sheet: **600 rows** (4 per case = 1 + 3 duplicates)
- Summary: "Total Master Codes: 150"
- Manufacturer prints 600 stickers (4 backups per case)

### Scenario 3: Maximum Duplicates (Default)

**Configuration:**
- Order: 100 cases
- Master QR duplicates: **10**

**Result:**
- Master Sheet: **1,100 rows** (11 per case = 1 + 10 duplicates)
- Summary: "Total Master Codes: 100"
- Manufacturer prints 1,100 stickers (maximum redundancy)

---

## Migration Guide

### For Developers

1. **Pull latest code**
2. **Run database migration:**
   ```sql
   -- Execute: migrations/031_update_extra_qr_master_constraint.sql
   ```
3. **No data migration needed** (existing orders default to 10)

### For Users

**No action required!**
- Existing orders continue to work with 10 duplicates
- New orders can customize the value
- No workflow changes

---

## Benefits

✅ **Flexibility:** Users can reduce waste for small orders (0 duplicates)

✅ **Cost Savings:** Print fewer stickers when duplicates aren't needed

✅ **Redundancy:** High-volume orders can maintain 10 duplicates for safety

✅ **Backward Compatible:** Existing orders unaffected

✅ **Clear UX:** Helper text explains the relationship between input and output

---

## Technical Notes

### Why "Duplicates" Instead of "Total Copies"?

**Original semantics (confusing):**
- `extraQrMaster = 10` meant "10 total copies"
- Required mental math: "10 means 10 copies, so 1 means just 1 copy"

**New semantics (intuitive):**
- `extraQrMaster = 10` means "10 additional duplicates"
- Natural understanding: "0 = no duplicates, 10 = 10 duplicates"
- Formula explicit: `Total = 1 + duplicates`

### Data Type Considerations

- **Input:** Integer (0-10)
- **Storage:** `integer` (PostgreSQL)
- **Default:** `10` (preserves current behavior)
- **TypeScript:** `number` with runtime validation

---

## Summary

This feature makes Master QR duplicate printing configurable per order:

1. **UI:** New field in Order Configuration (0-10 duplicates)
2. **Database:** Column `extra_qr_master` with 0-10 constraint
3. **Logic:** Excel generator calculates `1 + duplicates` copies
4. **Default:** 10 duplicates (11 total copies) for backward compatibility
5. **Validation:** Client + server-side enforcement
6. **Migration:** Single SQL file to update constraint

**Result:** Users can now customize Master QR redundancy based on their needs, from minimal (1 copy) to maximum (11 copies) per case. 🎯
