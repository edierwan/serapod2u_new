# Mark Case Perfect - Implementation Plan

## Problem

Currently, for a "perfect case" (no spoiled/damaged codes), the manufacturer
still needs to:

1. Scan ALL 100 individual QR codes
2. Then scan master case
3. Click "Link to Master Case"

This is time-consuming and unnecessary for perfect cases.

## Solution: "Mark Case Perfect" Button

### User Flow:

1. User scans **ONLY** the master case QR code
2. Clicks **"Mark Case Perfect"** button
3. System automatically:
   - Finds all QR codes for that case (based on sequence range)
   - Marks them all as `status = 'packed'` and `master_code_id = master_id`
   - Updates master case `actual_unit_count` and `status = 'packed'`
   - No need to scan individual codes!

### UI Changes Needed:

**In ManufacturerScanViewV2.tsx** - Add button next to "Link to Master Case":

```tsx
<div className="grid grid-cols-2 gap-2">
  <Button
    onClick={handleLinkToMaster}
    disabled={linking || scannedCodes.length === 0 || !masterCode ||
      isOrderLocked}
    size="lg"
  >
    <LinkIcon className="h-5 w-5 mr-2" />
    Link to Master Case
  </Button>

  <Button
    onClick={handleMarkCasePerfect}
    disabled={markingPerfect || !masterCode || scannedCodes.length > 0 ||
      isOrderLocked}
    variant="outline"
    size="lg"
    className="border-green-600 text-green-600 hover:bg-green-50"
  >
    {markingPerfect
      ? (
        <>
          <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
          Marking...
        </>
      )
      : (
        <>
          <CheckCircle className="h-5 w-5 mr-2" />
          Mark Case Perfect
        </>
      )}
  </Button>
</div>;
```

**Button behavior:**

- ✅ Enabled when: Master code scanned AND no unique codes scanned
- ❌ Disabled when: Unique codes exist in buffer (user should use normal flow)
- ❌ Disabled when: Order locked

### API Endpoint Needed:

**POST `/api/manufacturer/mark-case-perfect/route.ts`**

```typescript
{
  master_code: string,
  manufacturer_org_id: string,
  user_id: string
}
```

**Logic:**

1. Find master case record by `master_code`
2. Get `case_number` and `expected_unit_count` from master
3. Calculate sequence range:
   - Min: `(case_number - 1) * expected_unit_count + 1`
   - Max: `case_number * expected_unit_count`
4. Find ALL qr_codes WHERE:
   - `batch_id = master.batch_id`
   - `sequence_number >= min AND sequence_number <= max`
   - `master_code_id IS NULL` (not already linked)
   - `variant_id = master's variant` (if applicable)
5. Batch update qr_codes:
   - `master_code_id = master.id`
   - `status = 'packed'`
   - `last_scanned_at = now()`
   - `current_location_org_id = manufacturer_org_id`
6. Update master case:
   - `actual_unit_count = expected_unit_count`
   - `status = 'packed'`
   - `manufacturer_scanned_at = now()`

### Database Schema (Already Exists!)

No changes needed - we already have:

- ✅ `qr_codes.master_code_id`
- ✅ `qr_codes.sequence_number`
- ✅ `qr_master_codes.case_number`
- ✅ `qr_master_codes.expected_unit_count`

### Safety Features:

1. **Validation**: Ensure exactly `expected_unit_count` codes exist in sequence
   range
2. **Conflict Check**: If ANY code in range already has `master_code_id`, reject
   with error
3. **Variant Matching**: Only link codes with matching variant
4. **Idempotent**: If case already marked perfect, return success (don't error)

### Benefits:

- ⚡ **90% faster** for perfect cases
- ✅ **No scanning** of 100 individual codes
- 🎯 **Less errors** - no manual scanning mistakes
- 💼 **Better UX** - one click for perfect cases

### When to Use Each Button:

| Scenario                     | Button to Use                         | Why                                   |
| ---------------------------- | ------------------------------------- | ------------------------------------- |
| **Perfect case (no damage)** | "Mark Case Perfect"                   | Fast! No individual scans needed      |
| **Case with spoiled codes**  | Mode B/C first, then "Link to Master" | Need to exclude/replace damaged codes |
| **Case with mixed variants** | "Link to Master" with scanned codes   | Need manual selection                 |

### Updated Instructions in UI:

```tsx
<div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
  <h4 className="text-sm font-medium text-gray-900 mb-2">Instructions:</h4>

  <div className="mb-3">
    <p className="text-sm font-semibold text-green-700 mb-1">
      ✅ For Perfect Case (no damaged codes):
    </p>
    <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside ml-4">
      <li>Scan ONLY the master case QR code</li>
      <li>Click "Mark Case Perfect"</li>
      <li>Done! System marks all 100 codes automatically</li>
    </ol>
  </div>

  <div>
    <p className="text-sm font-semibold text-blue-700 mb-1">
      📦 For Case with Damaged Codes:
    </p>
    <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside ml-4">
      <li>Use Mode B or Mode C to handle spoiled codes first</li>
      <li>Then scan individual codes</li>
      <li>Scan master case QR code</li>
      <li>Click "Link to Master Case"</li>
    </ol>
  </div>
</div>;
```

## Files to Create/Modify:

1. **NEW**: `/app/src/app/api/manufacturer/mark-case-perfect/route.ts`
2. **MODIFY**:
   `/app/src/components/dashboard/views/qr-tracking/ManufacturerScanViewV2.tsx`
   - Add `markingPerfect` state
   - Add `handleMarkCasePerfect()` function
   - Modify button layout to 2-column grid
   - Update instructions

## Testing Checklist:

- [ ] Scan master code only → "Mark Case Perfect" enabled
- [ ] Scan master + unique codes → "Mark Case Perfect" disabled
- [ ] Click "Mark Case Perfect" → All 100 codes linked
- [ ] Master case status = 'packed'
- [ ] Master case actual_unit_count = 100
- [ ] Try clicking twice → Should be idempotent
- [ ] Try with already-linked codes → Should show error
- [ ] Try with missing codes → Should show error

## ✅ IMPLEMENTATION COMPLETE

### Files Created:

1. ✅ `/app/src/app/api/manufacturer/mark-case-perfect/route.ts` (356 lines)
   - Complete validation logic
   - Sequence range calculation
   - Batch update operations
   - Error handling and performance metrics
   - Idempotent operation support

### Files Modified:

2. ✅
   `/app/src/components/dashboard/views/qr-tracking/ManufacturerScanViewV2.tsx`
   - Added `markingPerfect` state variable (line 118)
   - Added `handleMarkCasePerfect()` function (lines 1283-1341)
   - Updated button layout to 2-column grid (lines 2108-2141)
   - Updated instructions to show both workflows (lines 2143-2164)

### Ready to Test:

The feature is now fully implemented and ready for testing!

**Quick Test Workflow:**

1. Navigate to Manufacturer Dashboard
2. Select an order with a batch
3. Scan ONLY the master case QR code (don't scan any individual codes)
4. Click "Mark Case Perfect" button
5. Verify all 100 codes are auto-linked and master case is marked as packed
