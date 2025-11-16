# Mode C - Detailed Logging & Cancel Feature

## Implementation Summary

### A. Detailed Logging

Added structured `[ModeC]` logging throughout the worker processor:

#### 1. Job Start Log
```javascript
[ModeC] Start job {
  jobId: 'uuid-xxx',
  orderId: 'uuid-order',
  batchId: 'uuid-batch',
  caseNumber: 2,
  variantKey: 'PROD-CELVA9464-CRA-843412',
  totalSpoiled: 6,
}
```

#### 2. Loaded Data Log
```javascript
[ModeC] Loaded data {
  jobId: 'uuid-xxx',
  spoiledSequences: [15, 22, 35, 48, 51, 67],
  normalCodesCount: 100,
  normalCodesSample: [
    { id: 'uuid-1', seq: 1, code: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00001-abc' },
    { id: 'uuid-2', seq: 2, code: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00002-def' },
    { id: 'uuid-3', seq: 3, code: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00003-ghi' }
  ],
  bufferCodesCount: 994,
  bufferCodesSample: [
    { id: 'uuid-buf-1', seq: 10001, code: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-BUF-10001-xyz' },
    { id: 'uuid-buf-2', seq: 10002, code: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-BUF-10002-aaa' },
    { id: 'uuid-buf-3', seq: 10003, code: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-BUF-10003-bbb' }
  ],
}
```

#### 3. Replace Spoiled with Buffer Logs (per code)
```javascript
[ModeC] Replace spoiled with buffer {
  jobId: 'uuid-xxx',
  spoiledSeq: 15,
  spoiledCodeId: 'uuid-code-15',
  spoiledCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00015-abc',
  bufferSeq: 10001,
  bufferCodeId: 'uuid-buf-1',
  bufferCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-BUF-10001-xyz',
}

[ModeC] Replace spoiled with buffer {
  jobId: 'uuid-xxx',
  spoiledSeq: 22,
  spoiledCodeId: 'uuid-code-22',
  spoiledCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00022-def',
  bufferSeq: 10002,
  bufferCodeId: 'uuid-buf-2',
  bufferCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-BUF-10002-aaa',
}

// ... (one per spoiled code)
```

#### 4. Job Finished Log (Success)
```javascript
[ModeC] Job finished {
  jobId: 'uuid-xxx',
  status: 'completed',
  totalSpoiled: 6,
  totalReplacements: 6,
  finalUnitCount: 100,
  masterCode: 'MASTER-ORD-HM-1125-02-CASE-002-xxx',
  error: null,
  durationMs: 52,
}
```

#### 5. Job Finished Log (Failed)
```javascript
[ModeC] Job finished {
  jobId: 'uuid-xxx',
  status: 'failed',
  totalSpoiled: 10,
  totalReplacements: 0,
  finalUnitCount: 0,
  masterCode: null,
  error: 'Insufficient buffer codes: need 10 but only 5 available for this variant.',
  durationMs: 28,
}
```

#### 6. Job Cancelled Mid-Processing
```javascript
[ModeC] Job cancelled mid-processing { jobId: 'uuid-xxx' }
```

---

### B. Cancel Job Feature

#### API Endpoint
- **POST** `/api/manufacturer/modec/jobs/{jobId}/cancel`
- Validates user is manufacturer member
- Only allows cancel when status = 'queued' or 'running'
- Updates job status to 'cancelled'
- Sets `error_message` to "Cancelled by user from UI"

#### Worker Updates
1. **Excludes cancelled jobs from selection** (only selects 'queued')
2. **Mid-processing check**: Before processing each spoiled code, checks if job was cancelled
3. **Early return**: If cancelled, stops processing and returns immediately

#### UI Updates
1. **Cancel button**: Shows when `job.canCancel === true` (queued or running)
2. **Confirmation dialog**: "Cancel this job? Any further background processing will stop."
3. **Cancelled badge**: Gray badge with ⏹️ icon
4. **Cancelled card styling**: Grayed out with opacity-60
5. **Final count**: Shows "N/A" for cancelled jobs
6. **Cancelled message**: Shows reason in gray box

---

## Example Console Output

### Complete Job Flow (Success)

```bash
📋 Found 1 queued job(s) to process

[ModeC] Start job {
  jobId: 'e8f9a0b1-2c3d-4e5f-6789-0a1b2c3d4e5f',
  orderId: 'abc123-order',
  batchId: 'xyz789-batch',
  caseNumber: 2,
  variantKey: 'PROD-CELVA9464-CRA-843412',
  totalSpoiled: 6
}

🔄 Processing job e8f9a0b1 for Case #2
📍 Found master: MASTER-ORD-HM-1125-02-CASE-002-xxx (expected: 100 units)
📦 Loaded 100 normal codes for Case #2 (max expected: 100)
🔋 Buffer pool available: 994 codes

[ModeC] Loaded data {
  jobId: 'e8f9a0b1-2c3d-4e5f-6789-0a1b2c3d4e5f',
  spoiledSequences: [ 15, 22, 35, 48, 51, 67 ],
  normalCodesCount: 100,
  normalCodesSample: [
    {
      id: 'code-uuid-1',
      seq: 1,
      code: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00001-abc123'
    },
    {
      id: 'code-uuid-2',
      seq: 2,
      code: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00002-def456'
    },
    {
      id: 'code-uuid-3',
      seq: 3,
      code: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00003-ghi789'
    }
  ],
  bufferCodesCount: 994,
  bufferCodesSample: [
    {
      id: 'buf-uuid-1',
      seq: 10001,
      code: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-BUF-10001-xyz123'
    },
    {
      id: 'buf-uuid-2',
      seq: 10002,
      code: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-BUF-10002-aaa456'
    },
    {
      id: 'buf-uuid-3',
      seq: 10003,
      code: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-BUF-10003-bbb789'
    }
  ]
}

🔴 Processing 6 spoiled code(s)
  🔴 Processing spoiled sequence: 15

[ModeC] Replace spoiled with buffer {
  jobId: 'e8f9a0b1-2c3d-4e5f-6789-0a1b2c3d4e5f',
  spoiledSeq: 15,
  spoiledCodeId: 'code-uuid-15',
  spoiledCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00015-abc',
  bufferSeq: 10001,
  bufferCodeId: 'buf-uuid-1',
  bufferCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-BUF-10001-xyz123'
}

  🟢 Using buffer: Seq 10001 → replaces Seq 15
  🔴 Processing spoiled sequence: 22

[ModeC] Replace spoiled with buffer {
  jobId: 'e8f9a0b1-2c3d-4e5f-6789-0a1b2c3d4e5f',
  spoiledSeq: 22,
  spoiledCodeId: 'code-uuid-22',
  spoiledCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00022-def',
  bufferSeq: 10002,
  bufferCodeId: 'buf-uuid-2',
  bufferCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-BUF-10002-aaa456'
}

  🟢 Using buffer: Seq 10002 → replaces Seq 22
  🔴 Processing spoiled sequence: 35

[ModeC] Replace spoiled with buffer {
  jobId: 'e8f9a0b1-2c3d-4e5f-6789-0a1b2c3d4e5f',
  spoiledSeq: 35,
  spoiledCodeId: 'code-uuid-35',
  spoiledCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00035-ghi',
  bufferSeq: 10003,
  bufferCodeId: 'buf-uuid-3',
  bufferCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-BUF-10003-bbb789'
}

  🟢 Using buffer: Seq 10003 → replaces Seq 35
  🔴 Processing spoiled sequence: 48

[ModeC] Replace spoiled with buffer {
  jobId: 'e8f9a0b1-2c3d-4e5f-6789-0a1b2c3d4e5f',
  spoiledSeq: 48,
  spoiledCodeId: 'code-uuid-48',
  spoiledCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00048-jkl',
  bufferSeq: 10004,
  bufferCodeId: 'buf-uuid-4',
  bufferCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-BUF-10004-ccc123'
}

  🟢 Using buffer: Seq 10004 → replaces Seq 48
  🔴 Processing spoiled sequence: 51

[ModeC] Replace spoiled with buffer {
  jobId: 'e8f9a0b1-2c3d-4e5f-6789-0a1b2c3d4e5f',
  spoiledSeq: 51,
  spoiledCodeId: 'code-uuid-51',
  spoiledCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00051-mno',
  bufferSeq: 10005,
  bufferCodeId: 'buf-uuid-5',
  bufferCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-BUF-10005-ddd456'
}

  🟢 Using buffer: Seq 10005 → replaces Seq 51
  🔴 Processing spoiled sequence: 67

[ModeC] Replace spoiled with buffer {
  jobId: 'e8f9a0b1-2c3d-4e5f-6789-0a1b2c3d4e5f',
  spoiledSeq: 67,
  spoiledCodeId: 'code-uuid-67',
  spoiledCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00067-pqr',
  bufferSeq: 10006,
  bufferCodeId: 'buf-uuid-6',
  bufferCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-BUF-10006-eee789'
}

  🟢 Using buffer: Seq 10006 → replaces Seq 67

✅ Processed: 6 replaced, 0 skipped
📍 Linking codes to master case #2
📊 Case #2: 100 codes linked to master MASTER-ORD-HM-1125-02-CASE-002-xxx

[ModeC] Job finished {
  jobId: 'e8f9a0b1-2c3d-4e5f-6789-0a1b2c3d4e5f',
  status: 'completed',
  totalSpoiled: 6,
  totalReplacements: 6,
  finalUnitCount: 100,
  masterCode: 'MASTER-ORD-HM-1125-02-CASE-002-xxx',
  error: null,
  durationMs: 52
}

✅ Job e8f9a0b1 completed in 52ms

✅ Worker completed: 1 job(s) in 58ms
```

---

### Job Cancelled Mid-Processing

```bash
📋 Found 1 queued job(s) to process

[ModeC] Start job {
  jobId: 'f1a2b3c4-5d6e-7f8a-9b0c-1d2e3f4a5b6c',
  orderId: 'abc123-order',
  batchId: 'xyz789-batch',
  caseNumber: 5,
  variantKey: 'PROD-CELVA9464-CRA-843412',
  totalSpoiled: 20
}

🔄 Processing job f1a2b3c4 for Case #5
📍 Found master: MASTER-ORD-HM-1125-05-CASE-005-xxx (expected: 100 units)
📦 Loaded 100 normal codes for Case #5 (max expected: 100)
🔋 Buffer pool available: 988 codes

[ModeC] Loaded data {
  jobId: 'f1a2b3c4-5d6e-7f8a-9b0c-1d2e3f4a5b6c',
  spoiledSequences: [ 5, 12, 18, 25, 33, 41, 52, 58, 64, 71, 77, 83, 89, 92, 95, 98, 99, 100, 101, 102 ],
  normalCodesCount: 100,
  normalCodesSample: [ ... ],
  bufferCodesCount: 988,
  bufferCodesSample: [ ... ]
}

🔴 Processing 20 spoiled code(s)
  🔴 Processing spoiled sequence: 5

[ModeC] Replace spoiled with buffer {
  jobId: 'f1a2b3c4-5d6e-7f8a-9b0c-1d2e3f4a5b6c',
  spoiledSeq: 5,
  spoiledCodeId: 'code-uuid-5',
  spoiledCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-05-00005-abc',
  bufferSeq: 10007,
  bufferCodeId: 'buf-uuid-7',
  bufferCode: 'PROD-CELVA9464-CRA-843412-ORD-HM-1125-BUF-10007-fff123'
}

  🟢 Using buffer: Seq 10007 → replaces Seq 5
  🔴 Processing spoiled sequence: 12

[ModeC] Job cancelled mid-processing { jobId: 'f1a2b3c4-5d6e-7f8a-9b0c-1d2e3f4a5b6c' }

✅ Worker completed: 0 job(s) in 15ms
```

---

## Testing Guide

### Test 1: View Detailed Logs

1. Start dev server: `npm run dev`
2. Open browser console and Network tab
3. Submit a Mode C job with 6 spoiled codes
4. Check terminal logs for structured `[ModeC]` logs
5. **Expected**: See all 5 log types with full QR code details

### Test 2: Cancel Queued Job

1. Submit a Mode C job
2. **Before it starts processing**, click "Cancel Job" button
3. Confirm cancellation
4. **Expected**:
   - Job status changes to "Cancelled"
   - Card grays out
   - Shows "⏹️ Cancelled" badge
   - Final Count shows "N/A"

### Test 3: Cancel Running Job

1. Submit a Mode C job with many spoiled codes (20+)
2. **While job is processing**, click "Cancel Job" button
3. Confirm cancellation
4. **Expected**:
   - Processing stops mid-way
   - Terminal shows `[ModeC] Job cancelled mid-processing`
   - Job status changes to "Cancelled"
   - Partial replacements may have occurred

### Test 4: Cannot Cancel Completed Job

1. Wait for a job to complete
2. **Expected**: No "Cancel" button visible (canCancel = false)

### Test 5: Database Verification

```sql
-- Check cancelled job
SELECT id, status, total_spoiled, total_replacements, error_message
FROM qr_reverse_jobs
WHERE status = 'cancelled'
ORDER BY created_at DESC
LIMIT 5;

-- Expected: status = 'cancelled', error_message = 'Cancelled by user from UI'
```

---

## Files Modified

1. **`/api/cron/qr-reverse-worker/route.ts`** (428 lines)
   - Added 5 structured `[ModeC]` log statements
   - Added mid-processing cancellation check
   - Excludes cancelled jobs from queue

2. **`/api/manufacturer/modec/jobs/[jobId]/cancel/route.ts`** (124 lines) - NEW
   - POST endpoint to cancel jobs
   - Auth validation (user must be manufacturer member)
   - Status validation (only queued/running can cancel)

3. **`/api/manufacturer/modec/jobs/route.ts`** (113 lines)
   - Added `canCancel` flag to job response

4. **`/components/manufacturer/ModeCReverseCaseView.tsx`** (470 lines)
   - Added `handleCancelJob` function
   - Added "Cancel" button with confirmation dialog
   - Added "cancelled" status badge (gray with ⏹️ icon)
   - Grayed out cancelled job cards
   - Shows "N/A" for final count on cancelled jobs
   - Shows cancellation message box

---

## Status

✅ All features implemented and tested  
✅ No TypeScript errors  
✅ Ready for production testing
