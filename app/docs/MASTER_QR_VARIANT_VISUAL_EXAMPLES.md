# Master QR Codes - Variant Column Visual Examples

## Quick Reference

**New Column:** "Variant" (Column E, width 50)

**Format:**
- Single variant: `Product Name - Variant Name`
- Mixed variants: `MIXED: Variant1 + Variant2 + ...`

---

## Example 1: Simple Single-Variant Order

### Order Details
- Product: Ellbow Cat Treat
- Variant: Chicken Antarctic Krill
- Quantity: 1000 units
- Case Size: 100 units/case
- Cases: 10 (all single variant)

### Master QR Codes Sheet Output

```
┌─────┬────────────────────────────────────────────────────────┬─────────────┬────────────────┬──────────────────────────────────────┐
│  #  │                    Tracking URL                        │ Case Number │ Expected Units │ Variant                              │
├─────┼────────────────────────────────────────────────────────┼─────────────┼────────────────┼──────────────────────────────────────┤
│  1  │ www.serapod2u.com/track/master/MASTER-ORD-HM-1125-...  │      1      │      100       │ Ellbow Cat Treat - Chicken Antarctic │
│  2  │ www.serapod2u.com/track/master/MASTER-ORD-HM-1125-...  │      1      │      100       │ Ellbow Cat Treat - Chicken Antarctic │
│  3  │ www.serapod2u.com/track/master/MASTER-ORD-HM-1125-...  │      1      │      100       │ Ellbow Cat Treat - Chicken Antarctic │
│ ... │                         ...                            │     ...     │      ...       │                 ...                  │
│ 11  │ www.serapod2u.com/track/master/MASTER-ORD-HM-1125-...  │      1      │      100       │ Ellbow Cat Treat - Chicken Antarctic │
│ 12  │ www.serapod2u.com/track/master/MASTER-ORD-HM-1125-...  │      2      │      100       │ Ellbow Cat Treat - Chicken Antarctic │
│ ... │                         ...                            │     ...     │      ...       │                 ...                  │
│110  │ www.serapod2u.com/track/master/MASTER-ORD-HM-1125-...  │     10      │      100       │ Ellbow Cat Treat - Chicken Antarctic │
└─────┴────────────────────────────────────────────────────────┴─────────────┴────────────────┴──────────────────────────────────────┘

Note: 10 cases × 11 copies (1 + 10 duplicates) = 110 rows
All rows show same variant: "Ellbow Cat Treat - Chicken Antarctic"
```

---

## Example 2: Multi-Variant Order (Individual Case Sizes)

### Order Details
- **Variant A:** Ellbow Cat Treat - Chicken Antarctic Krill
  - Quantity: 500 units @ 100/case → 5 cases
- **Variant B:** Ellbow Cat Treat - Tuna Prime
  - Quantity: 300 units @ 50/case → 6 cases
- **Variant C:** Ellbow Cat Treat - Salmon Feast
  - Quantity: 150 units @ 50/case → 3 cases
- **Mixed Case:** Remainders → 1 case with mixed variants

### Master QR Codes Sheet Output (Condensed View)

```
┌─────────────┬────────────────┬───────────────────────────────────────────────────────────┐
│ Case Number │ Expected Units │ Variant                                                   │
├─────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│      1      │      100       │ Ellbow Cat Treat - Chicken Antarctic                      │
│      2      │      100       │ Ellbow Cat Treat - Chicken Antarctic                      │
│      3      │      100       │ Ellbow Cat Treat - Chicken Antarctic                      │
│      4      │      100       │ Ellbow Cat Treat - Chicken Antarctic                      │
│      5      │      100       │ Ellbow Cat Treat - Chicken Antarctic                      │
├─────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│      6      │       50       │ Ellbow Cat Treat - Tuna Prime                             │
│      7      │       50       │ Ellbow Cat Treat - Tuna Prime                             │
│      8      │       50       │ Ellbow Cat Treat - Tuna Prime                             │
│      9      │       50       │ Ellbow Cat Treat - Tuna Prime                             │
│     10      │       50       │ Ellbow Cat Treat - Tuna Prime                             │
│     11      │       50       │ Ellbow Cat Treat - Tuna Prime                             │
├─────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│     12      │       50       │ Ellbow Cat Treat - Salmon Feast                           │
│     13      │       50       │ Ellbow Cat Treat - Salmon Feast                           │
│     14      │       50       │ Ellbow Cat Treat - Salmon Feast                           │
├─────────────┼────────────────┼───────────────────────────────────────────────────────────┤
│     15      │       25       │ MIXED: Ellbow - Chicken + Ellbow - Tuna + Ellbow - Salmon│
└─────────────┴────────────────┴───────────────────────────────────────────────────────────┘

Cases 1-5:   Single variant (Chicken, 100/case)
Cases 6-11:  Single variant (Tuna, 50/case)
Cases 12-14: Single variant (Salmon, 50/case)
Case 15:     MIXED (all 3 variants' remainders)
```

---

## Example 3: Large Multi-Variant Order (Standard Mode)

### Order Details
- 7 variants, each 3000 units
- Standard case size: 20 units/case
- Sequential packing (no mixed cases)
- Total: 1050 cases

### Master QR Codes Sheet Output (Sample Rows)

```
┌─────────────┬───────────────────────────────────────────────┐
│ Case Number │ Variant                                       │
├─────────────┼───────────────────────────────────────────────┤
│      1      │ Vape Chi - CHI-449021                         │
│      2      │ Vape Chi - CHI-449021                         │
│    ...      │              ...                              │
│    150      │ Vape Chi - CHI-449021                         │
├─────────────┼───────────────────────────────────────────────┤
│    151      │ Vape Men - MEN-550032                         │
│    152      │ Vape Men - MEN-550032                         │
│    ...      │              ...                              │
│    300      │ Vape Men - MEN-550032                         │
├─────────────┼───────────────────────────────────────────────┤
│    301      │ Vape Ber - BER-780045                         │
│    302      │ Vape Ber - BER-780045                         │
│    ...      │              ...                              │
│    450      │ Vape Ber - BER-780045                         │
├─────────────┼───────────────────────────────────────────────┤
│    451      │ Vape Ora - ORA-890123                         │
│    ...      │              ...                              │
│   1050      │ Vape Lim - LIM-345678 (last variant)          │
└─────────────┴───────────────────────────────────────────────┘

Each variant occupies exactly 150 cases (3000 ÷ 20 = 150)
Cases 1-150:    Variant 1
Cases 151-300:  Variant 2
Cases 301-450:  Variant 3
... (sequential pattern)
Cases 901-1050: Variant 7
```

---

## Example 4: Mixed Case Detail

### Scenario: Remainders from 3 Variants

**Order:**
- Variant A: 275 units @ 100/case → 2 full cases (200) + 75 remainder
- Variant B: 220 units @ 100/case → 2 full cases (200) + 20 remainder
- Variant C: 105 units @ 100/case → 1 full case (100) + 5 remainder

**Mixed Case:**
- Case 6: 75 (A) + 20 (B) + 5 (C) = 100 units total

### Master QR Codes Sheet (Showing Mixed Case)

```
┌─────┬─────────────┬────────────────┬──────────────────────────────────────────────────────────────┐
│  #  │ Case Number │ Expected Units │ Variant                                                      │
├─────┼─────────────┼────────────────┼──────────────────────────────────────────────────────────────┤
│ ... │     ...     │      ...       │                           ...                                │
│ 55  │      5      │      100       │ Ellbow Cat Treat - Salmon Feast                              │
├─────┼─────────────┼────────────────┼──────────────────────────────────────────────────────────────┤
│ 56  │      6      │      100       │ MIXED: Ellbow - Chicken + Ellbow - Tuna + Ellbow - Salmon   │
│ 57  │      6      │      100       │ MIXED: Ellbow - Chicken + Ellbow - Tuna + Ellbow - Salmon   │
│ ... │     ...     │      ...       │                           ...                                │
│ 66  │      6      │      100       │ MIXED: Ellbow - Chicken + Ellbow - Tuna + Ellbow - Salmon   │
└─────┴─────────────┴────────────────┴──────────────────────────────────────────────────────────────┘

Case 6 (rows 56-66): 11 copies of master QR (1 + 10 duplicates)
All show same mixed label with all 3 variants
```

---

## Example 5: Two-Variant Mixed Case

### Scenario: Simple Mixed Case

**Order:**
- Variant A: 150 units @ 100/case → 1 full case + 50 remainder
- Variant B: 50 units @ 100/case → 0 full cases + 50 remainder
- Mixed Case: 50 (A) + 50 (B) = 100 units

### Master QR Codes Sheet

```
┌─────────────┬────────────────┬──────────────────────────────────────────────────────┐
│ Case Number │ Expected Units │ Variant                                              │
├─────────────┼────────────────┼──────────────────────────────────────────────────────┤
│      1      │      100       │ Product A - Flavor 1                                 │
├─────────────┼────────────────┼──────────────────────────────────────────────────────┤
│      2      │      100       │ MIXED: Product A - Flavor 1 + Product B - Flavor 2  │
└─────────────┴────────────────┴──────────────────────────────────────────────────────┘

Case 1: Full case of Variant A
Case 2: Mixed case (A remainder + B remainder)
```

---

## Excel Filtering Examples

### Filter by Variant Type

**Show only MIXED cases:**
```
Filter Column E (Variant): "begins with" → "MIXED"
Result: Only mixed-variant cases displayed
```

**Show only Chicken variant cases:**
```
Filter Column E (Variant): "contains" → "Chicken"
Result: All Chicken cases (single + mixed)
```

**Exclude mixed cases:**
```
Filter Column E (Variant): "does not begin with" → "MIXED"
Result: Only single-variant cases displayed
```

---

## Sorting Examples

### Sort by Variant Name

**Primary Sort:** Column E (Variant) - A to Z

**Result:**
```
Case 1:  MIXED: ...
Case 15: MIXED: ...
Case 7:  Ellbow Cat Treat - Chicken Antarctic
Case 12: Ellbow Cat Treat - Chicken Antarctic
Case 3:  Ellbow Cat Treat - Salmon Feast
Case 9:  Ellbow Cat Treat - Tuna Prime
```

All MIXED cases grouped at top, then variants alphabetically

---

## Printed Label Examples

### Case Label Template

**Before (no variant info):**
```
┌─────────────────────────┐
│  ORDER: ORD-HM-1125-02  │
│  CASE: 15 of 30         │
│                         │
│  [Master QR Code]       │
└─────────────────────────┘
```

**After (with variant info from Excel):**
```
┌─────────────────────────────────────┐
│  ORDER: ORD-HM-1125-02              │
│  CASE: 15 of 30                     │
│  VARIANT: Ellbow Cat Treat - Chicken│
│                                     │
│  [Master QR Code]                   │
└─────────────────────────────────────┘
```

**For Mixed Case:**
```
┌─────────────────────────────────────┐
│  ORDER: ORD-HM-1125-02              │
│  CASE: 15 of 30                     │
│  MIXED CASE:                        │
│  - Chicken Antarctic (50 units)     │
│  - Tuna Prime (50 units)            │
│                                     │
│  [Master QR Code]                   │
└─────────────────────────────────────┘
```

---

## Buffer Code Handling

### Visual Example: Buffer Codes Ignored

**Order:**
- Production: 1000 units → 10 cases
- Buffer (5%): 50 units (not in cases)

**Master QR Codes Sheet:**
```
┌─────────────┬──────────────────────────────────┐
│ Case Number │ Variant                          │
├─────────────┼──────────────────────────────────┤
│      1      │ Ellbow Cat Treat - Chicken       │
│     ...     │             ...                  │
│     10      │ Ellbow Cat Treat - Chicken       │
└─────────────┴──────────────────────────────────┘

Only 10 cases shown (production codes only)
Buffer codes (50 units) NOT included in variant analysis
```

**Individual QR Codes Sheet (for reference):**
```
┌──────────────┬──────────┬──────────────────────────────────┐
│ Case Number  │ Is Buffer│ Variant                          │
├──────────────┼──────────┼──────────────────────────────────┤
│      1       │  FALSE   │ Ellbow Cat Treat - Chicken       │
│     ...      │  FALSE   │             ...                  │
│   BUFFER-1   │  TRUE    │ (buffer - not in master cases)  │
│   BUFFER-2   │  TRUE    │ (buffer - not in master cases)  │
└──────────────┴──────────┴──────────────────────────────────┘

Buffer codes have case_number = "BUFFER-N" (not numeric)
Excluded from Master QR variant analysis
```

---

## Summary Table

| Case Type          | Variant Column Format                              | Example                                                |
|--------------------|----------------------------------------------------|--------------------------------------------------------|
| Single Variant     | `Product Name - Variant Name`                      | Ellbow Cat Treat - Chicken Antarctic Krill             |
| Mixed (2 variants) | `MIXED: Variant1 + Variant2`                       | MIXED: Ellbow - Chicken + Ellbow - Tuna                |
| Mixed (3+ variants)| `MIXED: Variant1 + Variant2 + Variant3`           | MIXED: Vape Chi + Vape Men + Vape Ber                  |
| Empty Case (rare)  | *(empty)*                                          |                                                        |

---

## Key Insights

✅ **Visual Clarity:** Instant identification of case contents  
✅ **Mixed Cases:** Clearly labeled with "MIXED:" prefix  
✅ **Filtering:** Easy to isolate mixed cases or specific variants  
✅ **Sorting:** Alphabetical variant grouping  
✅ **Labels:** Can copy variant info to physical case labels  
✅ **Buffer Handling:** Buffers correctly excluded from analysis  

**Result:** Manufacturers can quickly identify case contents, verify packing accuracy, and generate variant-specific labels! 🎯
