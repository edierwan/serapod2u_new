# Excel Generation - Columns Removed

## Summary of Changes

Modified `/app/src/lib/excel-generator.ts` to remove specific columns from the
generated Excel sheets as requested.

---

## 1. Master QR Codes Sheet

### ✅ Columns REMOVED:

- ❌ **Column B**: Master QR Code
- ❌ **Column F**: Order No
- ❌ **Column G**: Print Instructions

### ✅ Columns REMAINING (After removal):

| Column | Header         | Width | Data                     |
| ------ | -------------- | ----- | ------------------------ |
| A      | #              | 6     | Index number             |
| B      | Tracking URL   | 60    | Master tracking URL      |
| C      | Case Number    | 14    | Case/box number          |
| D      | Expected Units | 16    | Number of units per case |

### Before (7 columns):

```
A: #
B: Master QR Code ❌ REMOVED
C: Tracking URL
D: Case Number
E: Expected Units
F: Order No ❌ REMOVED
G: Print Instructions ❌ REMOVED
```

### After (4 columns):

```
A: #
B: Tracking URL
C: Case Number
D: Expected Units
```

---

## 2. Individual QR Codes Sheet

### ✅ Columns REMOVED:

- ❌ **Column B**: Individual QR Code
- ❌ **Column I**: Master QR Code (Case)
- ❌ **Column K**: Master Tracking URL
- ❌ **Column L**: Order No
- ❌ **Column M**: Print Instructions

### ✅ Columns REMAINING (After removal):

| Column | Header                  | Width | Data                     |
| ------ | ----------------------- | ----- | ------------------------ |
| A      | #                       | 6     | Index number             |
| B      | Product Name            | 32    | Product name             |
| C      | Variant                 | 24    | Variant name             |
| D      | Individual Tracking URL | 65    | Product tracking URL     |
| E      | Sequence                | 12    | Sequence number          |
| F      | Product Code            | 18    | Product SKU code         |
| G      | Variant Code            | 18    | Variant SKU code         |
| H      | Case Number             | 14    | Which case it belongs to |

### Before (13 columns):

```
A: #
B: Individual QR Code ❌ REMOVED
C: Product Name
D: Variant
E: Individual Tracking URL
F: Sequence
G: Product Code
H: Variant Code
I: Master QR Code (Case) ❌ REMOVED
J: Case Number
K: Master Tracking URL ❌ REMOVED
L: Order No ❌ REMOVED
M: Print Instructions ❌ REMOVED
```

### After (8 columns):

```
A: #
B: Product Name
C: Variant
D: Individual Tracking URL
E: Sequence
F: Product Code
G: Variant Code
H: Case Number
```

---

## 3. Packing List Sheet

### ✅ NO CHANGES

This sheet remains unchanged as it's for internal packing/warehouse use:

- Case Number
- Master QR Code
- Expected Units
- Products in Case
- Status
- Packed By
- Packed Date

---

## Benefits of Changes

### 1. **Simplified Excel Files**

- Fewer columns = easier to read
- Less data to manage
- Faster to open and process

### 2. **Security & Privacy**

- QR codes not exposed in plain text in Excel
- Only tracking URLs remain (which require authentication to access)
- Reduces risk of unauthorized QR code duplication

### 3. **Cleaner Printing**

- Removed "Print Instructions" columns (redundant)
- Removed "Order No" columns (not needed on printouts)
- Focus on essential tracking data only

### 4. **Reduced File Size**

- Removing QR code strings (45-50 char each) significantly reduces file size
- Example: 10,000 codes × 50 chars = 500KB saved per file

---

## Code Changes

### Master Sheet - Before:

```typescript
sheet.columns = [
  { header: "#", key: "index", width: 6 },
  { header: "Master QR Code", key: "masterCode", width: 45 }, // ❌ REMOVED
  { header: "Tracking URL", key: "trackingUrl", width: 60 },
  { header: "Case Number", key: "caseNumber", width: 14 },
  { header: "Expected Units", key: "expectedUnits", width: 16 },
  { header: "Order No", key: "orderNo", width: 18 }, // ❌ REMOVED
  { header: "Print Instructions", key: "printInstructions", width: 38 }, // ❌ REMOVED
];
```

### Master Sheet - After:

```typescript
sheet.columns = [
  { header: "#", key: "index", width: 6 },
  { header: "Tracking URL", key: "trackingUrl", width: 60 },
  { header: "Case Number", key: "caseNumber", width: 14 },
  { header: "Expected Units", key: "expectedUnits", width: 16 },
];
```

### Individual Sheet - Before:

```typescript
sheet.columns = [
  { header: "#", key: "index", width: 6 },
  { header: "Individual QR Code", key: "code", width: 50 }, // ❌ REMOVED
  { header: "Product Name", key: "productName", width: 32 },
  { header: "Variant", key: "variantName", width: 24 },
  { header: "Individual Tracking URL", key: "trackingUrl", width: 65 },
  { header: "Sequence", key: "sequence", width: 12 },
  { header: "Product Code", key: "productCode", width: 18 },
  { header: "Variant Code", key: "variantCode", width: 18 },
  { header: "Master QR Code (Case)", key: "masterCode", width: 50 }, // ❌ REMOVED
  { header: "Case Number", key: "caseNumber", width: 14 },
  { header: "Master Tracking URL", key: "masterTrackingUrl", width: 65 }, // ❌ REMOVED
  { header: "Order No", key: "orderNo", width: 18 }, // ❌ REMOVED
  { header: "Print Instructions", key: "printInstructions", width: 32 }, // ❌ REMOVED
];
```

### Individual Sheet - After:

```typescript
sheet.columns = [
  { header: "#", key: "index", width: 6 },
  { header: "Product Name", key: "productName", width: 32 },
  { header: "Variant", key: "variantName", width: 24 },
  { header: "Individual Tracking URL", key: "trackingUrl", width: 65 },
  { header: "Sequence", key: "sequence", width: 12 },
  { header: "Product Code", key: "productCode", width: 18 },
  { header: "Variant Code", key: "variantCode", width: 18 },
  { header: "Case Number", key: "caseNumber", width: 14 },
];
```

---

## Testing

### To Test:

1. Generate a new QR batch from the system
2. Download the Excel file
3. Verify the following:

**Master QR Codes Sheet:**

- [ ] Only 4 columns (A-D)
- [ ] No "Master QR Code" column
- [ ] No "Order No" column
- [ ] No "Print Instructions" column
- [ ] Tracking URLs still present

**Individual QR Codes Sheet:**

- [ ] Only 8 columns (A-H)
- [ ] No "Individual QR Code" column
- [ ] No "Master QR Code (Case)" column
- [ ] No "Master Tracking URL" column
- [ ] No "Order No" column
- [ ] No "Print Instructions" column
- [ ] Product info and tracking URLs still present

**Packing List Sheet:**

- [ ] Unchanged - all 7 columns present

---

## Impact

### ✅ **No Breaking Changes**

- System functionality unchanged
- QR codes still stored in database
- Tracking URLs still work
- Only Excel export format changed

### ✅ **Backwards Compatible**

- Old Excel files still valid
- New system generates cleaner exports
- No migration needed

---

## File Modified

- ✅ `/app/src/lib/excel-generator.ts`
  - Modified `buildMasterSheet()` function
  - Modified `buildIndividualSheet()` function
  - No changes to `buildPackingSheet()` function

---

**Status:** ✅ Complete - Ready for testing!
