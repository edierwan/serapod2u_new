# Master QR Codes - Variant Column Feature

## Overview

The Master QR Codes sheet now includes a **Variant** column that displays which product variant(s) are packed in each case. This helps manufacturers quickly identify case contents without scanning individual codes.

---

## Feature Summary

**Added:** New "Variant" column in Master QR Codes sheet

**Purpose:** Show which product variant(s) are contained in each master case

**Logic:**
- **Single-variant cases:** Display "Product Name - Variant Name"
- **Mixed-variant cases:** Display "MIXED: Variant1 + Variant2 + ..."

---

## Implementation Details

### 1. Column Structure

**Before:**
```
┌───┬────────────────────┬─────────────┬────────────────┐
│ # │   Tracking URL     │ Case Number │ Expected Units │
├───┼────────────────────┼─────────────┼────────────────┤
│ 1 │ www.serapod2u.../1 │      1      │      100       │
└───┴────────────────────┴─────────────┴────────────────┘
```

**After:**
```
┌───┬────────────────────┬─────────────┬────────────────┬─────────────────────────────────┐
│ # │   Tracking URL     │ Case Number │ Expected Units │ Variant                         │
├───┼────────────────────┼─────────────┼────────────────┼─────────────────────────────────┤
│ 1 │ www.serapod2u.../1 │      1      │      100       │ Ellbow Cat Treat - Chicken Krill│
└───┴────────────────────┴─────────────┴────────────────┴─────────────────────────────────┘
```

### 2. Algorithm

**Step 1: Build Mapping**
```typescript
// Map: caseNumber -> Set<variantKey>
const caseVariants = new Map<number, Set<string>>()

// Map: variantKey -> "Product Name - Variant Name"
const variantNames = new Map<string, string>()

// Analyze individual codes (excluding buffers)
for (const code of data.individualCodes) {
  if (code.is_buffer) continue  // Buffers not packed in cases
  
  const variantKey = `${code.product_code}-${code.variant_code}`
  const variantName = `${code.product_name} - ${code.variant_name}`
  
  // Track variants per case
  caseVariants.get(caseNo).add(variantKey)
  variantNames.set(variantKey, variantName)
}
```

**Step 2: Generate Labels**
```typescript
const variantsSet = caseVariants.get(master.case_number)

if (variantsSet.size === 1) {
  // Single variant
  variantLabel = "Ellbow Cat Treat - Chicken Antarctic Krill"
} else {
  // Mixed variants
  variantLabel = "MIXED: Variant1 + Variant2 + Variant3"
}
```

**Step 3: Add to Row**
```typescript
const row = sheet.addRow({
  index: rowIndex++,
  trackingUrl: generateTrackingURL(master.code, 'master'),
  caseNumber: master.case_number,
  expectedUnits: master.expected_unit_count,
  variantLabel  // NEW
})
```

---

## Examples

### Example 1: Single-Variant Order

**Order Configuration:**
- Product: Ellbow Cat Treat
- Variant: Chicken Antarctic Krill
- Quantity: 3000 units
- Case Size: 100 units/case
- Result: 30 cases, all same variant

**Master QR Codes Sheet:**
```
┌───┬────────────────────────────────────┬─────────────┬────────────────┬──────────────────────────────────────┐
│ # │          Tracking URL              │ Case Number │ Expected Units │ Variant                              │
├───┼────────────────────────────────────┼─────────────┼────────────────┼──────────────────────────────────────┤
│ 1 │ www.serapod2u.com/track/master/... │      1      │      100       │ Ellbow Cat Treat - Chicken Antarctic │
│ 2 │ www.serapod2u.com/track/master/... │      1      │      100       │ Ellbow Cat Treat - Chicken Antarctic │
│...│                ...                 │     ...     │      ...       │                 ...                  │
│30 │ www.serapod2u.com/track/master/... │     30      │      100       │ Ellbow Cat Treat - Chicken Antarctic │
└───┴────────────────────────────────────┴─────────────┴────────────────┴──────────────────────────────────────┘

All 30 cases show same variant: "Ellbow Cat Treat - Chicken Antarctic Krill"
```

---

### Example 2: Multi-Variant Order (Individual Case Sizes)

**Order Configuration:**
- Variant A: 2500 units @ 100/case → 25 full cases
- Variant B: 1500 units @ 50/case → 30 full cases
- Remainders packed in mixed case
- Result: 55 full cases + 1 mixed case

**Master QR Codes Sheet:**
```
┌───┬────────────────────────────────────┬─────────────┬────────────────┬─────────────────────────────────────────────────┐
│ # │          Tracking URL              │ Case Number │ Expected Units │ Variant                                         │
├───┼────────────────────────────────────┼─────────────┼────────────────┼─────────────────────────────────────────────────┤
│ 1 │ www.serapod2u.com/track/master/... │      1      │      100       │ Ellbow Cat Treat - Chicken Antarctic            │
│...│                ...                 │     ...     │      ...       │                 ...                             │
│25 │ www.serapod2u.com/track/master/... │     25      │      100       │ Ellbow Cat Treat - Chicken Antarctic            │
│26 │ www.serapod2u.com/track/master/... │     26      │       50       │ Ellbow Cat Treat - Tuna Prime                   │
│...│                ...                 │     ...     │      ...       │                 ...                             │
│55 │ www.serapod2u.com/track/master/... │     55      │       50       │ Ellbow Cat Treat - Tuna Prime                   │
│56 │ www.serapod2u.com/track/master/... │     56      │       25       │ MIXED: Ellbow - Chicken + Ellbow - Tuna         │
└───┴────────────────────────────────────┴─────────────┴────────────────┴─────────────────────────────────────────────────┘

Cases 1-25: Single variant (Chicken)
Cases 26-55: Single variant (Tuna)
Case 56: MIXED (Chicken + Tuna remainders)
```

---

### Example 3: Standard Mode with Multiple Variants

**Order Configuration:**
- 3 variants packed sequentially
- Standard case size: 200 units/case
- Variant A: 1000 units → Cases 1-5
- Variant B: 800 units → Cases 6-9
- Variant C: 600 units → Cases 10-12
- Result: All single-variant cases (no mixing)

**Master QR Codes Sheet:**
```
┌─────────────┬─────────────────────────────────────────────┐
│ Case Number │ Variant                                     │
├─────────────┼─────────────────────────────────────────────┤
│      1      │ Vape Product - Cherry Flavor                │
│      2      │ Vape Product - Cherry Flavor                │
│      3      │ Vape Product - Cherry Flavor                │
│      4      │ Vape Product - Cherry Flavor                │
│      5      │ Vape Product - Cherry Flavor                │
│      6      │ Vape Product - Menthol Flavor               │
│      7      │ Vape Product - Menthol Flavor               │
│      8      │ Vape Product - Menthol Flavor               │
│      9      │ Vape Product - Menthol Flavor               │
│     10      │ Vape Product - Berry Flavor                 │
│     11      │ Vape Product - Berry Flavor                 │
│     12      │ Vape Product - Berry Flavor                 │
└─────────────┴─────────────────────────────────────────────┘
```

---

## Key Characteristics

### 1. Buffer Codes Excluded

**Logic:** Only production codes (non-buffer) are analyzed

**Reason:** Buffer codes have `case_number = 0` and are not packed in physical cases

**Example:**
```typescript
for (const code of data.individualCodes) {
  if (code.is_buffer) continue  // Skip buffers
  // ... process production codes only
}
```

### 2. Variant Key Format

**Format:** `{product_code}-{variant_code}`

**Example:** `VAPE001-MINT` or `CAT-CHI-449021`

**Purpose:** Unique identifier to detect when same variant appears multiple times

### 3. Mixed Case Detection

**Condition:** `variantsSet.size > 1`

**Label Format:** `MIXED: {Variant1} + {Variant2} + ...`

**Example:**
```
MIXED: Ellbow Cat Treat - Chicken Antarctic Krill + Ellbow Cat Treat - Tuna Prime
```

### 4. Column Width

**Width:** 50 characters

**Rationale:**
- Single variants: Typically 30-40 chars
- Mixed (2 variants): ~70 chars (wraps in Excel)
- Readable without excessive white space

---

## Edge Cases

### Case 1: Empty Case (No Production Codes)

**Scenario:** Master code exists but no individual codes mapped to it (rare)

**Result:** `variantLabel = ''` (empty string)

**Display:** Blank cell in Variant column

---

### Case 2: Buffer-Only Order

**Scenario:** Order with 100% buffer (0% production)

**Result:** All variant labels empty (buffers ignored)

**Expected:** This scenario should never occur (order requires production codes)

---

### Case 3: Very Long Variant Names

**Scenario:** Product/variant names exceed column width

**Result:** Excel wraps text automatically

**Mitigation:** Column width set to 50 for balance

---

### Case 4: Three or More Variants in One Case

**Scenario:** Mixed case with 3+ variants

**Label:**
```
MIXED: Variant1 + Variant2 + Variant3
```

**Display:** May wrap to multiple lines in Excel (automatic)

---

## Impact Analysis

### ✅ No Changes to QR Generation

- Master QR codes: **Unchanged**
- Individual QR codes: **Unchanged**
- Buffer logic: **Unchanged**
- Case numbering: **Unchanged**

**This is display-only feature!**

### ✅ No Performance Impact

- Mapping built once before writing rows
- O(n) complexity where n = number of individual codes
- Minimal memory overhead (2 small maps)

### ✅ Backward Compatible

- Existing orders: Work as before
- New orders: Automatically include Variant column
- Excel readers: Additional column ignored if not needed

---

## Testing Checklist

### Single-Variant Orders
- [x] Order with 1 variant, 10 cases
- [x] Verify all 10 cases show same variant name
- [x] Check variant label format: "Product - Variant"

### Multi-Variant Orders (Individual Case Sizes)
- [x] Order with 3 variants, each full cases
- [x] Verify each variant's cases show correct label
- [x] Check mixed case shows "MIXED: Variant1 + Variant2"

### Multi-Variant Orders (Standard Mode)
- [x] Order with 5 variants, sequential packing
- [x] Verify variant changes at correct case boundaries
- [x] No mixed cases in standard sequential packing

### Buffer Handling
- [x] Order with 10% buffer
- [x] Verify buffer codes don't affect variant labels
- [x] Check production cases only show production variants

### Edge Cases
- [x] Very long product/variant names
- [x] Single character names
- [x] Special characters in names
- [x] Multiple spaces in names

---

## Files Modified

1. **`/app/src/lib/excel-generator.ts`**
   - Updated `buildMasterSheet()` function
   - Added Variant column definition
   - Added case → variant mapping logic
   - Added variant label generation logic

---

## Benefits

✅ **Clarity:** Manufacturers immediately see case contents

✅ **Efficiency:** No need to scan individual codes to identify variant

✅ **Quality Control:** Quickly verify correct variants in correct cases

✅ **Mixed Cases:** Clear labeling prevents confusion

✅ **Sorting:** Excel users can filter/sort by variant

✅ **Documentation:** Physical cases can be labeled with variant info

---

## Real-World Usage

### Warehouse Packing

**Before:**
"Which variant is in Case 15?"
→ Must scan individual codes or cross-reference order

**After:**
"Case 15: Ellbow Cat Treat - Chicken Antarctic Krill"
→ Instant visibility in Excel

---

### Quality Inspection

**Before:**
Inspector must scan codes to verify case contents match order

**After:**
Inspector can cross-reference printed variant with Excel sheet

---

### Shipping Labels

**Before:**
Generic "Case 15 of 30" labels

**After:**
Can include variant on shipping label:
"Case 15 - Chicken Antarctic Krill"

---

## Summary

The Variant column enhances Master QR Codes sheet with **display-only** variant identification:

1. **Single-variant cases:** Show "Product Name - Variant Name"
2. **Mixed-variant cases:** Show "MIXED: Variant1 + Variant2 + ..."
3. **Buffer codes:** Excluded from variant analysis
4. **Zero impact:** No changes to QR codes, packing, or logic
5. **Automatic:** Works for all case packing modes (standard/individual)

**Result:** Manufacturers can instantly identify case contents without scanning, improving efficiency and reducing errors. 🎯
