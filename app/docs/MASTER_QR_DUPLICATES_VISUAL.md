# Master QR Duplicates - Visual Examples

## UI Screenshots

### Order Configuration Section

```
┌────────────────────────────────────────────────────────────────────────┐
│  Order Configuration                                                   │
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Case Size Configuration                                               │
│  ○ Same units per case for all products                                │
│    All products will use the same case size (recommended)              │
│                                                                         │
│  ○ Individual units per case for each product                          │
│    Set different case sizes for each product variant                   │
│                                                                         │
│  ┌─────────────────────────┐  ┌─────────────────────────┐            │
│  │ Units per Case          │  │ QR Buffer (%)           │            │
│  │ ┌────────────────────┐  │  │ ┌────────────────────┐  │            │
│  │ │ 100 units per case ▾│  │  │ │ 10                 │  │            │
│  │ └────────────────────┘  │  │ └────────────────────┘  │            │
│  │ [Custom]                │  │ Additional QR codes for │            │
│  │                         │  │ manufacturing           │            │
│  └─────────────────────────┘  └─────────────────────────┘            │
│                                                                         │
│  Master QR copies per case ✨ NEW                                      │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │ 10                                                              │   │
│  └────────────────────────────────────────────────────────────────┘   │
│  How many duplicate Master QR stickers to print per case (0-10).      │
│  0 = only 1 sticker per case, 10 = 11 stickers per case.              │
│                                                                         │
│  ☑ This order supports RFID                                            │
│     RFID tags will equal the total number of Master QR codes           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Value Examples

### Example 1: Minimal Printing (0 Duplicates)

**User Input:**
```
Master QR copies per case: [0]
```

**Interpretation:**
- 0 duplicates = **1 sticker per case** (just the original)
- No backup copies
- Ideal for: Small internal orders, test runs

**Excel Output (100 cases):**
- Master Sheet: **100 rows**
- Each case gets exactly 1 QR sticker

---

### Example 2: Moderate Redundancy (3 Duplicates)

**User Input:**
```
Master QR copies per case: [3]
```

**Interpretation:**
- 3 duplicates = **4 stickers per case** (1 original + 3 backups)
- Moderate redundancy
- Ideal for: Standard production runs

**Excel Output (100 cases):**
- Master Sheet: **400 rows** (100 cases × 4 copies)
- Each case gets 4 QR stickers for backup

---

### Example 3: Maximum Redundancy (10 Duplicates - Default)

**User Input:**
```
Master QR copies per case: [10]
```

**Interpretation:**
- 10 duplicates = **11 stickers per case** (1 original + 10 backups)
- Maximum redundancy
- Ideal for: Large orders, high-risk environments

**Excel Output (100 cases):**
- Master Sheet: **1,100 rows** (100 cases × 11 copies)
- Each case gets 11 QR stickers for maximum backup

---

## Excel Output Comparison

### Case Study: 50-Case Order

#### Configuration A: 0 Duplicates
```
Master Sheet:
┌───────┬──────────────────────────────────────┬─────────────┬────────────────┐
│   #   │          Tracking URL                │ Case Number │ Expected Units │
├───────┼──────────────────────────────────────┼─────────────┼────────────────┤
│   1   │ www.serapod2u.com/track/master/...   │      1      │      100       │
│   2   │ www.serapod2u.com/track/master/...   │      2      │      100       │
│  ...  │                 ...                  │     ...     │      ...       │
│  50   │ www.serapod2u.com/track/master/...   │     50      │      100       │
└───────┴──────────────────────────────────────┴─────────────┴────────────────┘

Total Rows: 50 (1 per case)
Summary: "Total Master Codes (Cases): 50"
```

#### Configuration B: 3 Duplicates
```
Master Sheet:
┌───────┬──────────────────────────────────────┬─────────────┬────────────────┐
│   #   │          Tracking URL                │ Case Number │ Expected Units │
├───────┼──────────────────────────────────────┼─────────────┼────────────────┤
│   1   │ www.serapod2u.com/track/master/...   │      1      │      100       │ ┐
│   2   │ www.serapod2u.com/track/master/...   │      1      │      100       │ │
│   3   │ www.serapod2u.com/track/master/...   │      1      │      100       │ ├─ Case 1: 4 copies
│   4   │ www.serapod2u.com/track/master/...   │      1      │      100       │ ┘
│   5   │ www.serapod2u.com/track/master/...   │      2      │      100       │ ┐
│   6   │ www.serapod2u.com/track/master/...   │      2      │      100       │ │
│   7   │ www.serapod2u.com/track/master/...   │      2      │      100       │ ├─ Case 2: 4 copies
│   8   │ www.serapod2u.com/track/master/...   │      2      │      100       │ ┘
│  ...  │                 ...                  │     ...     │      ...       │
│  200  │ www.serapod2u.com/track/master/...   │     50      │      100       │ ← Case 50: 4 copies
└───────┴──────────────────────────────────────┴─────────────┴────────────────┘

Total Rows: 200 (4 per case = 1 + 3 duplicates)
Summary: "Total Master Codes (Cases): 50"
```

#### Configuration C: 10 Duplicates (Default)
```
Master Sheet:
┌───────┬──────────────────────────────────────┬─────────────┬────────────────┐
│   #   │          Tracking URL                │ Case Number │ Expected Units │
├───────┼──────────────────────────────────────┼─────────────┼────────────────┤
│   1   │ www.serapod2u.com/track/master/...   │      1      │      100       │ ┐
│   2   │ www.serapod2u.com/track/master/...   │      1      │      100       │ │
│   3   │ www.serapod2u.com/track/master/...   │      1      │      100       │ │
│  ...  │                 ...                  │     ...     │      ...       │ ├─ Case 1: 11 copies
│  10   │ www.serapod2u.com/track/master/...   │      1      │      100       │ │
│  11   │ www.serapod2u.com/track/master/...   │      1      │      100       │ ┘
│  12   │ www.serapod2u.com/track/master/...   │      2      │      100       │ ┐
│  ...  │                 ...                  │     ...     │      ...       │ ├─ Case 2: 11 copies
│  22   │ www.serapod2u.com/track/master/...   │      2      │      100       │ ┘
│  ...  │                 ...                  │     ...     │      ...       │
│  550  │ www.serapod2u.com/track/master/...   │     50      │      100       │ ← Case 50: 11 copies
└───────┴──────────────────────────────────────┴─────────────┴────────────────┘

Total Rows: 550 (11 per case = 1 + 10 duplicates)
Summary: "Total Master Codes (Cases): 50"
```

---

## Console Logs

### During Excel Generation

**Before (Old Logic):**
```
✅ Master QR Codes sheet created (100 unique codes × 10 copies = 1000 rows)
```

**After (New Logic):**
```
✅ Master QR Codes sheet created (100 unique codes × 11 copies (1 + 10 duplicates) = 1100 rows)
```

The new log clearly shows:
- Unique codes: 100
- Copies per case: 11
- Breakdown: 1 original + 10 duplicates
- Total rows: 1,100

---

## Validation Messages

### Client-Side Validation

**Scenario:** User enters `-5`
```
Input: [-5]
Result: Rejected (onChange handler ignores invalid values)
Display: Previous valid value remains
```

**Scenario:** User enters `15`
```
Input: [15]
Result: Rejected (onChange handler ignores invalid values)
Display: Previous valid value remains
```

**Scenario:** User enters `7`
```
Input: [7]
Result: Accepted ✅
Display: [7]
Meaning: 8 stickers per case (1 + 7 duplicates)
```

### Server-Side Validation

**Database Constraint:**
```sql
CHECK ((extra_qr_master >= 0) AND (extra_qr_master <= 10))
```

**API Clamping:**
```typescript
extra_qr_master: Math.max(0, Math.min(10, masterQrDuplicates))
```

---

## Real-World Scenarios

### Scenario 1: Test Order (Minimize Waste)

**Situation:** Company wants to test QR system with a small order

**Configuration:**
- 10 cases
- Master QR duplicates: **0**

**Result:**
- Print only **10 stickers** (1 per case)
- Minimal waste
- Fast turnaround

---

### Scenario 2: Standard Production

**Situation:** Regular production run with moderate risk

**Configuration:**
- 200 cases
- Master QR duplicates: **3**

**Result:**
- Print **800 stickers** (4 per case)
- Good balance of redundancy and cost
- Sufficient backups for damaged stickers

---

### Scenario 3: High-Volume Export

**Situation:** Large export order with high damage risk

**Configuration:**
- 500 cases
- Master QR duplicates: **10**

**Result:**
- Print **5,500 stickers** (11 per case)
- Maximum redundancy
- Handles rough shipping conditions

---

## Summary Table

| Input Value | Duplicates | Total Copies | Use Case                          |
|-------------|------------|--------------|-----------------------------------|
| **0**       | 0          | 1            | Test orders, minimal printing     |
| **1**       | 1          | 2            | Very low risk                     |
| **3**       | 3          | 4            | Standard production               |
| **5**       | 5          | 6            | Moderate risk environments        |
| **10**      | 10         | 11 (default) | High-risk, large orders, exports  |

**Key Insight:** Value represents **additional duplicates**, not total copies. Total copies = 1 + value.

---

## Helper Text Variations

### Concise Version (Current)
```
How many duplicate Master QR stickers to print per case (0-10). 
0 = only 1 sticker per case, 10 = 11 stickers per case.
```

### Detailed Version (Alternative)
```
Number of additional duplicate Master QR codes per case (0-10).
• 0 duplicates = 1 sticker (just the original)
• 10 duplicates = 11 stickers (maximum backup)
Default: 10 duplicates (11 total copies per case)
```

### Tooltip Version (Hover)
```
Master QR Duplicates

Configures how many backup copies of each Master QR code to print.

Examples:
- 0: Print 1 sticker per case (no backups)
- 3: Print 4 stickers per case (1 + 3 backups)
- 10: Print 11 stickers per case (1 + 10 backups) [DEFAULT]

Recommendation: Use 10 for export orders, 3 for domestic, 0 for tests.
```

---

## Result: Clear, flexible, and cost-effective Master QR printing! 🎯
