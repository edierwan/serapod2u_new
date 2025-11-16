# Where to Find Mode C/D (Async Reverse Batch)

## 🎯 Quick Navigation

### Step-by-Step:

1. **Navigate to Manufacturer Scan**
   - From your dashboard sidebar
   - Click **"Manufacturer Scan"**

2. **Select an Order**
   - You'll see a card at the top: **"Select Order to Track Progress"**
   - Choose any order from the dropdown
   - ⚠️ **Important:** Mode selector only appears AFTER you select an order

3. **Choose Packing Mode**
   - After selecting an order, a **NEW purple card** will appear
   - Title: **"Select Packing Mode"**
   - You'll see 4 options in a 2x2 grid:

   ```
   ┌─────────────────────────────────────┬─────────────────────────────────────┐
   │  Mode A · Scan & Manually Assign    │  Mode B · Bulk Capture → Auto Case  │
   │  Scan QR codes, then manually link  │  Capture codes first, auto-create   │
   │  them to a master case.             │  master case when targets are met.  │
   └─────────────────────────────────────┴─────────────────────────────────────┘
   ┌─────────────────────────────────────┬─────────────────────────────────────┐
   │  Mode C · Import Packing Plan       │  Mode D · Async Reverse ⭐          │
   │  Paste Excel export to auto-assign  │  Background processing - paste      │
   │  master cases from planned mapping. │  exclusions and continue working.   │
   └─────────────────────────────────────┴─────────────────────────────────────┘
   ```

4. **Click Mode D**
   - The card will highlight in purple
   - Below it, you'll see: **"Current Mode: Mode D · Async Reverse..."**
   - The UI will switch to show the **async reverse batch interface**

5. **Use Mode D Interface**
   - You'll see:
     - "Paste QR codes to exclude" textarea
     - "Submit Reverse Batch Job" button
     - After submitting: Real-time progress bar
     - After completion: "Prepared Codes" section with master linking

## 🚨 Common Issues

### "I don't see the mode selector!"

**Cause:** You haven't selected an order yet.

**Fix:**

1. Look for the **blue card** at the top
2. It says: "Select Order to Track Progress"
3. Click the dropdown and choose ANY order
4. The **purple "Select Packing Mode"** card will appear below it

### "I only see Mode A and Mode B in a different UI"

**Cause:** You're looking at the OLD "Batch Scan Mode" toggle inside the "Scan
Unique QR Codes" card. That's a different feature.

**Fix:**

- Scroll UP to the top of the page
- Look for the **purple card** labeled "Select Packing Mode" (appears after
  selecting an order)
- That's where Mode A/B/C/D options are

### "The order dropdown says 'All Orders'"

**Fix:**

- Change it from "All Orders" to a SPECIFIC order
- Only when a specific order is selected will the mode selector appear

## 📸 Visual Reference

```
┌─────────────────────────────────────────────────────────────┐
│  🎯 STEP 1: SELECT ORDER (Blue Card)                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Select Order to Track Progress                        │  │
│  │ [Dropdown: ORD-HM-1125-05 - Organization Name ▼]     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

                             ↓

┌─────────────────────────────────────────────────────────────┐
│  📦 STEP 2: CHOOSE MODE (Purple Card - NEW!)               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Select Packing Mode                                   │  │
│  │                                                        │  │
│  │ ┌──────────────┐ ┌──────────────┐                   │  │
│  │ │ Mode A       │ │ Mode B       │                   │  │
│  │ └──────────────┘ └──────────────┘                   │  │
│  │ ┌──────────────┐ ┌──────────────┐                   │  │
│  │ │ Mode C       │ │ Mode D ⭐    │ ← CLICK HERE!    │  │
│  │ └──────────────┘ └──────────────┘                   │  │
│  │                                                        │  │
│  │ Current Mode: Mode D · Async Reverse...               │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

                             ↓

┌─────────────────────────────────────────────────────────────┐
│  🚀 STEP 3: USE MODE D (Appears Below)                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Background Async Reverse Batch                        │  │
│  │                                                        │  │
│  │ Paste codes to exclude (one per line):               │  │
│  │ ┌───────────────────────────────────────────────────┐ │  │
│  │ │ ORD-HM-1125-05-A-001                              │ │  │
│  │ │ ORD-HM-1125-05-A-002                              │ │  │
│  │ │ ORD-HM-1125-05-A-003                              │ │  │
│  │ └───────────────────────────────────────────────────┘ │  │
│  │                                                        │  │
│  │ [Submit Reverse Batch Job]                            │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 🔧 Troubleshooting

If you still can't see Mode D after following these steps:

1. **Check that order is selected:**
   ```bash
   Look at the dropdown - it should NOT say "All Orders"
   ```

2. **Refresh the page:**
   ```bash
   Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
   ```

3. **Check browser console for errors:**
   ```bash
   Press F12 → Console tab → Look for any red errors
   ```

4. **Verify file changes were saved:**
   ```bash
   cd /Users/macbook/serapod2u_new
   grep -n "Mode D · Async Reverse" app/src/components/dashboard/views/qr-tracking/ManufacturerScanViewV2.tsx
   ```
   Should show matches on lines with "Mode D"

## ✅ Confirmation Checklist

- [ ] I can see the "Select Order to Track Progress" blue card
- [ ] I selected a SPECIFIC order (not "All Orders")
- [ ] I can see the **"Select Packing Mode"** purple card appear
- [ ] I can see 4 mode options in the purple card
- [ ] I can see "Mode D · Async Reverse (Recommended for 1000+ units)"
- [ ] Clicking Mode D changes the UI below
- [ ] I can see the "Background Async Reverse Batch" interface

---

## 📚 Related Docs

- [Quick Start Guide](./MODE_C_QUICK_START.md) - How to use Mode C
- [Technical Documentation](./MODE_C_ASYNC_REVERSE_BATCH.md) - Full technical
  specs
- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md) - Complete file list
