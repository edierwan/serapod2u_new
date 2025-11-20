# Buffer Group Visual Examples

## Quick Reference: Buffer Group Format

```
Production Code:  Case 1-150        | Is Buffer: FALSE | Buffer Group: (empty)
Buffer Code:      BUFFER-1 to 150   | Is Buffer: TRUE  | Buffer Group: B{variant}-{0001}
```

---

## Example 1: Single Variant (CHI-449021)

**Order Details:**

- Product: Vape Chi
- Variant: CHI-449021
- Production: 3000 units
- Buffer: 150 units (5%)
- Case Size: 20 units/case

### Excel Output (Sample Rows):

```
┌─────┬──────────────┬────────────┬──────────────┬──────────┬───────────┬──────────────────────┐
│  #  │ Product Name │  Variant   │ Case Number  │ Is Buffer│Buffer Group              │
├─────┼──────────────┼────────────┼──────────────┼──────────┼───────────────────────────┤
│  1  │ Vape Chi     │ CHI-449021 │      1       │  FALSE   │                          │
│  2  │ Vape Chi     │ CHI-449021 │      1       │  FALSE   │                          │
│ ... │     ...      │    ...     │     ...      │   ...    │           ...            │
│ 20  │ Vape Chi     │ CHI-449021 │      1       │  FALSE   │                          │
│ 21  │ Vape Chi     │ CHI-449021 │      2       │  FALSE   │                          │
│ ... │     ...      │    ...     │     ...      │   ...    │           ...            │
│2981 │ Vape Chi     │ CHI-449021 │    150       │  FALSE   │                          │
│ ... │     ...      │    ...     │     ...      │   ...    │           ...            │
│3000 │ Vape Chi     │ CHI-449021 │    150       │  FALSE   │                          │
├─────┼──────────────┼────────────┼──────────────┼──────────┼───────────────────────────┤
│3001 │ Vape Chi     │ CHI-449021 │  BUFFER-1    │   TRUE   │ BCHI-449021-0001 ✅      │
│3002 │ Vape Chi     │ CHI-449021 │  BUFFER-2    │   TRUE   │ BCHI-449021-0002 ✅      │
│3003 │ Vape Chi     │ CHI-449021 │  BUFFER-3    │   TRUE   │ BCHI-449021-0003 ✅      │
│ ... │     ...      │    ...     │     ...      │   ...    │           ...            │
│3150 │ Vape Chi     │ CHI-449021 │  BUFFER-150  │   TRUE   │ BCHI-449021-0150 ✅      │
└─────┴──────────────┴────────────┴──────────────┴──────────┴───────────────────────────┘

Summary:
✅ Production: 3000 codes with Case 1-150
✅ Buffer: 150 codes with BUFFER-1 to BUFFER-150
✅ Buffer Group: BCHI-449021-0001 to BCHI-449021-0150
```

---

## Example 2: Multiple Variants

**Order Details:**

- 3 variants, each with 3000 production + 150 buffer

### Variant 1: CHI-449021 (Cherry Flavor)

```
Production Codes (3000):
Row 1-3000    | Case 1-150      | FALSE | (empty)

Buffer Codes (150):
Row 3001-3150 | BUFFER-1 to 150 | TRUE  | BCHI-449021-0001 to 0150
```

### Variant 2: MEN-550032 (Menthol Flavor)

```
Production Codes (3000):
Row 3151-6150 | Case 1-150      | FALSE | (empty)

Buffer Codes (150):
Row 6151-6300 | BUFFER-1 to 150 | TRUE  | BMEN-550032-0001 to 0150
```

### Variant 3: BER-780045 (Berry Flavor)

```
Production Codes (3000):
Row 6301-9300 | Case 1-150      | FALSE | (empty)

Buffer Codes (150):
Row 9301-9450 | BUFFER-1 to 150 | TRUE  | BBER-780045-0001 to 0150
```

### Complete Excel View (Buffer Codes Only):

```
┌─────┬──────────────┬────────────┬──────────────┬──────────┬──────────────────────┐
│  #  │ Product Name │  Variant   │ Case Number  │ Is Buffer│ Buffer Group         │
├─────┼──────────────┼────────────┼──────────────┼──────────┼──────────────────────┤
│3001 │ Vape Chi     │ CHI-449021 │  BUFFER-1    │   TRUE   │ BCHI-449021-0001     │
│3002 │ Vape Chi     │ CHI-449021 │  BUFFER-2    │   TRUE   │ BCHI-449021-0002     │
│ ... │     ...      │    ...     │     ...      │   ...    │         ...          │
│3150 │ Vape Chi     │ CHI-449021 │  BUFFER-150  │   TRUE   │ BCHI-449021-0150     │
├─────┼──────────────┼────────────┼──────────────┼──────────┼──────────────────────┤
│6151 │ Vape Menthol │ MEN-550032 │  BUFFER-1    │   TRUE   │ BMEN-550032-0001     │
│6152 │ Vape Menthol │ MEN-550032 │  BUFFER-2    │   TRUE   │ BMEN-550032-0002     │
│ ... │     ...      │    ...     │     ...      │   ...    │         ...          │
│6300 │ Vape Menthol │ MEN-550032 │  BUFFER-150  │   TRUE   │ BMEN-550032-0150     │
├─────┼──────────────┼────────────┼──────────────┼──────────┼──────────────────────┤
│9301 │ Vape Berry   │ BER-780045 │  BUFFER-1    │   TRUE   │ BBER-780045-0001     │
│9302 │ Vape Berry   │ BER-780045 │  BUFFER-2    │   TRUE   │ BBER-780045-0002     │
│ ... │     ...      │    ...     │     ...      │   ...    │         ...          │
│9450 │ Vape Berry   │ BER-780045 │  BUFFER-150  │   TRUE   │ BBER-780045-0150     │
└─────┴──────────────┴────────────┴──────────────┴──────────┴──────────────────────┘
```

**Key Observation:** Each variant has independent buffer numbering (BUFFER-1 to
150), but unique Buffer Groups prevent confusion!

---

## Printed QR Sticker Example

When manufacturers print QR stickers, they can include the Buffer Group on the
label:

### Production Sticker

```
┌────────────────────────┐
│  ██████████████████    │
│  ██  QR CODE  ████     │
│  ██████████████████    │
│                        │
│  Vape Chi              │
│  CHI-449021            │
│  Case 1                │
└────────────────────────┘
```

### Buffer Sticker (NEW!)

```
┌────────────────────────┐
│  ██████████████████    │
│  ██  QR CODE  ████     │
│  ██████████████████    │
│                        │
│  Vape Chi              │
│  CHI-449021            │
│  BUFFER-1              │
│  BCHI-449021-0001 ✅   │  ← Clear identification!
└────────────────────────┘
```

---

## Sorting and Filtering in Excel

### Sort by Buffer Group

Excel users can easily sort buffer codes by variant:

```
Filter: Is Buffer = TRUE
Sort: Buffer Group (A-Z)

Result:
BBER-780045-0001
BBER-780045-0002
...
BBER-780045-0150
BCHI-449021-0001
BCHI-449021-0002
...
BCHI-449021-0150
BMEN-550032-0001
BMEN-550032-0002
...
BMEN-550032-0150
```

### Filter by Specific Variant

Want only CHI-449021 buffer codes?

```
Filter 1: Is Buffer = TRUE
Filter 2: Buffer Group contains "BCHI-449021"

Result: All 150 buffer codes for CHI-449021 variant
```

---

## Real-World Scenario

### Problem: Mixed Buffer Stickers

**Situation:** During packing, buffer QR stickers for 3 variants fall on the
floor and get mixed up.

**Before (without Buffer Group):**

```
Worker picks up stickers with no clear markings...
❌ "Which variant does this buffer belong to?"
❌ "Do I check the full product name?"
❌ Risk of applying wrong buffer to wrong product
```

**After (with Buffer Group):**

```
Worker sees Buffer Group printed on each sticker:
✅ BCHI-449021-0045 → Goes with Cherry variant
✅ BMEN-550032-0078 → Goes with Menthol variant  
✅ BBER-780045-0102 → Goes with Berry variant
✅ Instant identification, no confusion!
```

---

## Buffer Group Breakdown

### Format Components

```
B  CHI-449021  -  0001
│      │        │    │
│      │        │    └── Sequence (4 digits, zero-padded)
│      │        └──────── Separator
│      └───────────────── Variant Code
└──────────────────────── Buffer Prefix

Examples:
BCHI-449021-0001  → Buffer #1 for CHI-449021
BCHI-449021-0150  → Buffer #150 for CHI-449021
BMEN-550032-0001  → Buffer #1 for MEN-550032 (different variant!)
```

### Why This Format?

1. **B Prefix**: Immediately identifies as buffer
2. **Variant Code**: Shows which product variant
3. **4-Digit Sequence**: Supports up to 9999 buffer codes per variant
4. **Hyphen Separator**: Easy to read and parse

---

## Summary Table

| Code Type      | Case Number     | Is Buffer | Buffer Group     | Purpose                                 |
| -------------- | --------------- | --------- | ---------------- | --------------------------------------- |
| **Production** | 1-150 (number)  | FALSE     | (empty)          | Regular product codes assigned to cases |
| **Buffer**     | BUFFER-1 to 150 | TRUE      | B{variant}-{seq} | Spare codes with variant identification |

**Result:** Clear, organized, and traceable buffer code management! 🎯
