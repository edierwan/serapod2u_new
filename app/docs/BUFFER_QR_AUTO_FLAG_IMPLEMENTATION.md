# Buffer QR Code Auto-Flagging Implementation

## Overview
Updated the QR code generation system to automatically flag buffer codes per product variant with proper `is_buffer`, `variant_key`, and `case_number` fields.

## Changes Made

### 1. QR Generator Library (`/app/src/lib/qr-generator.ts`)

#### Added New Fields to Interface
```typescript
export interface GeneratedQRCode {
  // ... existing fields ...
  is_buffer: boolean      // NEW: Flag for buffer codes
  variant_key: string     // NEW: PROD-{product_code}-{variant_code}-{manufacturer_code}
}
```

#### Updated Generation Parameters
```typescript
export interface QRCodeGenerationParams {
  orderNo: string
  manufacturerCode?: string  // NEW: For variant_key construction
  // ... other fields ...
}
```

#### Updated Generation Logic

**Normal Codes (Lines 148-184):**
- Set `is_buffer: false` for all codes within ordered quantity
- Assign proper `case_number` (1-based, increments when case is full)
- Build `variant_key` as `PROD-{product_code}-{variant_code}-{manufacturer_code}`

**Buffer Codes (Lines 196-246):**
- Set `is_buffer: true` for all buffer codes
- Set `case_number: 0` (not assigned to any case)
- Build same `variant_key` format to group with variant's normal codes
- Distributed proportionally across variants

### 2. QR Batch Generation API (`/app/src/app/api/qr-batches/generate/route.ts`)

#### Pass Manufacturer Code (Line 107)
```typescript
const qrBatch = generateQRBatch({
  orderNo: order.order_no,
  manufacturerCode: order.seller_org.org_code,  // NEW
  orderItems,
  bufferPercent: order.qr_buffer_percent || 10,
  unitsPerCase: order.units_per_case || 100
})
```

#### Update Database Insert (Lines 321-332)
```typescript
const inserts = chunk.map(code => ({
  // ... existing fields ...
  case_number: code.case_number,      // NEW
  variant_key: code.variant_key,      // NEW
  is_buffer: code.is_buffer,          // NEW
  status: code.is_buffer ? 'buffer_available' : 'printed',  // NEW
}))
```

## How It Works

### Example: Order ORD-HM-1125-02

**Variant A: Cranberry Lychee**
- Product Code: `CELVA9464`
- Variant Code: `CRA-843412`
- Manufacturer Code: `HM` (from seller_org.org_code)
- Normal Quantity: 3000 units
- Buffer Quantity: 100 units (10%)
- Units Per Case: 100

**Generated Codes:**

| Sequence Range | is_buffer | case_number | variant_key | status |
|---|---|---|---|---|
| 1-3000 | false | 1-30 | PROD-CELVA9464-CRA-843412-HM | printed |
| 3001-3100 | true | 0 | PROD-CELVA9464-CRA-843412-HM | buffer_available |

**Variant B: Keladi Cheese**
- Product Code: `CELVA9464`
- Variant Code: `KEL-866575`
- Manufacturer Code: `HM`
- Normal Quantity: 2000 units
- Buffer Quantity: 200 units (10%)
- Units Per Case: 100

**Generated Codes:**

| Sequence Range | is_buffer | case_number | variant_key | status |
|---|---|---|---|---|
| 3101-5100 | false | 31-50 | PROD-CELVA9464-KEL-866575-HM | printed |
| 5101-5300 | true | 0 | PROD-CELVA9464-KEL-866575-HM | buffer_available |

## Verification Queries

### Check Variant A Buffer Codes
```sql
SELECT 
  sequence_number, 
  is_buffer, 
  case_number,
  variant_key,
  status
FROM qr_codes
WHERE order_id = '<order-id>' 
  AND variant_key = 'PROD-CELVA9464-CRA-843412-HM'
ORDER BY sequence_number;
```

**Expected Results:**
- Seq 1-3000: `is_buffer=false`, `case_number=1-30`, `status=printed`
- Seq 3001-3100: `is_buffer=true`, `case_number=0`, `status=buffer_available`

### Check Variant B Buffer Codes
```sql
SELECT 
  sequence_number, 
  is_buffer, 
  case_number,
  variant_key,
  status
FROM qr_codes
WHERE order_id = '<order-id>' 
  AND variant_key = 'PROD-CELVA9464-KEL-866575-HM'
ORDER BY sequence_number;
```

**Expected Results:**
- Seq 3101-5100: `is_buffer=false`, `case_number=31-50`, `status=printed`
- Seq 5101-5300: `is_buffer=true`, `case_number=0`, `status=buffer_available`

### Check All Buffer Codes in Order
```sql
SELECT 
  variant_key,
  COUNT(*) as buffer_count,
  MIN(sequence_number) as first_buffer_seq,
  MAX(sequence_number) as last_buffer_seq
FROM qr_codes
WHERE order_id = '<order-id>' 
  AND is_buffer = true
GROUP BY variant_key
ORDER BY MIN(sequence_number);
```

## Benefits

1. **Per-Variant Buffer Pool**: Buffer codes are properly grouped by variant_key, preventing cross-variant usage
2. **Automatic Status**: Buffer codes get `buffer_available` status, normal codes get `printed`
3. **Clear Identification**: `is_buffer` flag makes it easy to filter buffer vs normal codes
4. **Case Isolation**: Buffer codes have `case_number=0`, clearly separating them from packed cases
5. **Mode C Compatibility**: Mode C reverse job can now query buffer codes per variant correctly

## Mode C Integration

The Mode C reverse job now uses these fields to:
- Query buffer codes: `WHERE is_buffer = true AND status = 'buffer_available'`
- Filter by variant: `WHERE variant_key = '<specific-variant-key>'`
- Avoid cross-contamination: Buffer codes from other variants won't be used
- Prevent case conflicts: Buffer codes won't interfere with packed cases

## Future Orders

All new QR batches generated will automatically have:
- ✅ `is_buffer` correctly set based on normal vs buffer ranges
- ✅ `variant_key` properly formatted per variant
- ✅ `case_number` assigned correctly (1-N for normal, 0 for buffer)
- ✅ `status` set appropriately (`printed` or `buffer_available`)

## Backfilling Existing Data

To backfill existing orders (if needed), run a separate migration script that:
1. Identifies buffer codes by sequence_number ranges per variant
2. Updates `is_buffer`, `variant_key`, `case_number`, and `status` accordingly

**Note:** This implementation only affects NEW QR code generation, not existing data.

---

**Date:** November 14, 2025  
**Status:** ✅ Complete - Ready for testing with new orders
