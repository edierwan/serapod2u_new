# Buffer Group Identification Feature

## Overview

Buffer QR codes now include a **Buffer Group** identifier that allows
manufacturers to clearly identify which product variant each buffer code belongs
to, even after printing the QR stickers.

## Problem Solved

**Before:** Buffer QR codes had empty case numbers, making it difficult to
identify which product/variant they belonged to after printing.

**After:** Each buffer code now shows:

1. **Case Number**: `BUFFER-N` (sequential per variant)
2. **Buffer Group**: `B{variant_code}-{0001}` (unique identifier)

---

## Implementation

### Excel Structure Changes

Added new column to "Individual QR Codes" sheet:

| #    | Product Name | Variant    | ... | Case Number  | Is Buffer | **Buffer Group**     |
| ---- | ------------ | ---------- | --- | ------------ | --------- | -------------------- |
| 1    | Vape Chi     | CHI-449021 | ... | 1            | FALSE     |                      |
| ...  | ...          | ...        | ... | ...          | ...       |                      |
| 3001 | Vape Chi     | CHI-449021 | ... | **BUFFER-1** | TRUE      | **BCHI-449021-0001** |
| 3002 | Vape Chi     | CHI-449021 | ... | **BUFFER-2** | TRUE      | **BCHI-449021-0002** |

### Logic

#### For Production Codes (is_buffer = false):

```typescript
const variantKey = `${product_code}-${variant_code}`;
const localSeq = (variantLocalSeq.get(variantKey) || 0) + 1;
variantLocalSeq.set(variantKey, localSeq);

caseNumber = Math.ceil(localSeq / caseSize); // e.g., 1, 2, 3...
bufferGroup = ""; // Empty
```

#### For Buffer Codes (is_buffer = true):

```typescript
const variantKey = `${product_code}-${variant_code}`;
const bufferSeq = (variantBufferSeq.get(variantKey) || 0) + 1;
variantBufferSeq.set(variantKey, bufferSeq);

caseNumber = `BUFFER-${bufferSeq}`; // e.g., BUFFER-1, BUFFER-2
bufferGroup = `B${variant_code}-${String(bufferSeq).padStart(4, "0")}`;
// Example: BCHI-449021-0001
```

---

## Example Output

### Single Variant: CHI-449021 (3000 production + 150 buffer)

**Production Codes (rows 1-3000):**

```
Case Number | Is Buffer | Buffer Group
1           | FALSE     | 
1           | FALSE     | 
...
150         | FALSE     |
```

**Buffer Codes (rows 3001-3150):**

```
Case Number | Is Buffer | Buffer Group
BUFFER-1    | TRUE      | BCHI-449021-0001
BUFFER-2    | TRUE      | BCHI-449021-0002
BUFFER-3    | TRUE      | BCHI-449021-0003
...
BUFFER-150  | TRUE      | BCHI-449021-0150
```

### Multiple Variants

**Variant 1: CHI-449021 Buffer Codes:**

```
BUFFER-1    | TRUE      | BCHI-449021-0001
BUFFER-2    | TRUE      | BCHI-449021-0002
...
BUFFER-150  | TRUE      | BCHI-449021-0150
```

**Variant 2: MEN-550032 Buffer Codes:**

```
BUFFER-1    | TRUE      | BMEN-550032-0001
BUFFER-2    | TRUE      | BMEN-550032-0002
...
BUFFER-150  | TRUE      | BMEN-550032-0150
```

---

## Benefits

### 1. **Clear Identification After Printing**

When QR stickers are printed and separated, manufacturers can easily identify
which variant each buffer code belongs to by looking at the Buffer Group printed
alongside the QR code.

### 2. **Organized Buffer Management**

- **BUFFER-N**: Shows sequential numbering within each variant
- **B{variant}-{seq}**: Provides unique identifier that won't be confused
  between variants

### 3. **No Impact on Production Codes**

- Production codes remain unchanged
- Case numbering still follows per-variant logic (Case 1-150)
- Master QR codes unaffected

### 4. **Traceability**

Each buffer code can be traced back to its specific product variant using the
Buffer Group identifier.

---

## Use Cases

### Scenario 1: Damaged Label Replacement

A production worker needs to replace a damaged label on product CHI-449021:

1. Look for buffer codes with **BCHI-449021-xxxx**
2. Select any unused buffer code from that group
3. Apply the replacement sticker

### Scenario 2: Inventory Management

Warehouse manager wants to count remaining buffer codes:

1. Sort Excel by **Buffer Group** column
2. Each variant's buffer codes are grouped together
3. Easy to count: BCHI-449021-0001 through BCHI-449021-0150

### Scenario 3: Multiple Variants in Same Box

During packing, buffer QR stickers for different variants get mixed:

1. Each sticker has Buffer Group printed on it
2. Workers can quickly sort by looking at the prefix (BCHI vs BMEN)
3. No confusion about which variant the buffer belongs to

---

## Technical Details

### Column Specifications

- **Position**: Column J (10th column)
- **Width**: 22 characters (accommodates longest variant codes)
- **Header**: "Buffer Group"

### Buffer Group Format

```
B{variant_code}-{sequence}

Components:
- Prefix: "B" (indicates Buffer)
- Variant Code: Full variant code (e.g., CHI-449021)
- Separator: "-"
- Sequence: 4-digit zero-padded number (0001-9999)

Examples:
- BCHI-449021-0001
- BMEN-550032-0099
- BBER-780045-0150
```

### Per-Variant Sequencing

Each variant maintains its own buffer sequence counter:

- Variant 1: BUFFER-1 to BUFFER-150
- Variant 2: BUFFER-1 to BUFFER-150 (independent)
- Variant 3: BUFFER-1 to BUFFER-150 (independent)

---

## Validation

### Acceptance Tests

✅ **All buffer codes show BUFFER-N in Case Number**

```typescript
// Buffer codes have caseNumber = 'BUFFER-1', 'BUFFER-2', etc.
bufferCodes.forEach((code) => {
    expect(code.caseNumber).toMatch(/^BUFFER-\d+$/);
});
```

✅ **All buffer codes show unique Buffer Group per variant**

```typescript
// Buffer Group format: B{variant}-{0001}
bufferCodes.forEach((code) => {
    expect(code.bufferGroup).toMatch(/^B.+-\d{4}$/);
});
```

✅ **Production codes unaffected**

```typescript
productionCodes.forEach((code) => {
    expect(typeof code.caseNumber).toBe("number");
    expect(code.bufferGroup).toBe("");
});
```

✅ **Master QR count unchanged**

- Master codes only cover production cases
- Buffer codes don't affect master code count

---

## Migration Notes

### Existing Data

This feature only affects **new QR batch generation**. Existing Excel files are
not retroactively updated.

### Database Schema

No database changes required. This is purely an Excel presentation feature.

### Backward Compatibility

- Old Excel files (without Buffer Group column) remain valid
- New Excel files include the additional column
- No breaking changes to QR code generation logic

---

## Visual Comparison

### Before (Old Format)

```
Case Number | Is Buffer
1           | FALSE
2           | FALSE
...
(empty)     | TRUE      ← Hard to identify variant!
(empty)     | TRUE
```

### After (New Format)

```
Case Number | Is Buffer | Buffer Group
1           | FALSE     | 
2           | FALSE     | 
...
BUFFER-1    | TRUE      | BCHI-449021-0001  ← Clear identification!
BUFFER-2    | TRUE      | BCHI-449021-0002
```

---

## Summary

The Buffer Group feature enhances buffer QR code management by:

1. Adding visual identifiers (BUFFER-N) in Case Number column
2. Providing unique Buffer Group IDs per variant
3. Enabling easy identification after printing
4. Maintaining all existing production code logic
5. Zero impact on master QR codes and case packing

**Result:** Manufacturers can now efficiently manage and replace damaged labels
using clearly identified buffer QR codes.
