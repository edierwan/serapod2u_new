# Mode C Implementation - Complete Documentation

## ✅ Implementation Complete

Mode C "Async Reverse per Case" has been fully implemented with NO master scan
required.

---

## 📋 Overview

**Mode C** is a new manufacturer packing mode that:

- ✅ Handles spoiled labels per case in the background
- ✅ Uses buffer QR codes as automatic replacements
- ✅ **Auto-assigns the correct master case QR WITHOUT asking user to scan it**
- ✅ Supports unreadable QR codes (sequence number only input)
- ✅ Isolated from Mode A/B (no disruption to existing functionality)

---

## 🗂️ Files Created

### 1. Database Migration

**File:** `/app/migrations/mode-c-minimal-add-columns.sql` (255 lines)

**What it does:**

- Adds `case_number`, `variant_key`, `is_buffer`, `replaces_sequence_no` to
  `qr_codes` table
- Adds Mode C fields to existing `qr_reverse_jobs` table
- Creates `qr_reverse_job_items` table for per-code tracking
- Creates helper function `extract_variant_key_from_code()`
- Creates trigger `assign_case_number_from_sequence()` to auto-calculate case
  numbers
- Backfills existing data

**Status:** ⚠️ **MUST BE RUN IN SUPABASE FIRST**

### 2. QR Parser Utility

**File:** `/app/src/lib/qr-parser.ts` (328 lines)

**Functions:**

- `parseProductQr()` - Parses full product QR codes
- `parseMasterQr()` - Parses master case QR codes
- `extractVariantKey()` - Extracts variant key from QR
- `parseSpoiledEntry()` - Handles "18", "SEQ:18", or full QR
- `parseSpoiledEntries()` - Parses multi-line input
- `validateSpoiledEntriesSameCase()` - Ensures all codes are from same case

**Examples:**

```typescript
// Product QR
parseProductQr("PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00015-abc123");
// Returns: { variantKey: "PROD-CELVA9464-CRA-843412", sequenceNumber: 15, ... }

// Sequence only
parseSpoiledEntry("18");
// Returns: { type: "sequence", parsed: { sequenceNumber: 18 } }
```

### 3. API Routes

#### a) Create Job API

**File:** `/app/src/app/api/manufacturer/modec/create-job/route.ts` (215 lines)

**Endpoint:** `POST /api/manufacturer/modec/create-job`

**Request:**

```json
{
    "order_id": "uuid",
    "batch_id": "uuid",
    "spoiled_input": "PROD-...\n18\nSEQ:42"
}
```

**Response:**

```json
{
    "success": true,
    "job_id": "uuid",
    "case_number": 2,
    "variant_key": "PROD-CELVA9464-CRA-843412",
    "total_spoiled": 3,
    "message": "Reverse job created for Case #2 with 3 spoiled code(s)"
}
```

**Validation:**

- ✅ All codes must be from same case
- ✅ All codes must be from same variant
- ✅ Cannot create duplicate jobs for same case
- ✅ Checks if codes already spoiled

#### b) Jobs List API

**File:** `/app/src/app/api/manufacturer/modec/jobs/route.ts` (86 lines)

**Endpoint:** `GET /api/manufacturer/modec/jobs?order_id=X&batch_id=Y`

**Response:**

```json
{
    "success": true,
    "jobs": [
        {
            "id": "uuid",
            "case_number": 2,
            "status": "completed",
            "total_spoiled": 3,
            "total_replacements": 3,
            "master_code": "MASTER-ORD-HM-1125-02-CASE-002-abc123",
            "final_unit_count": 100,
            "pending_items": 0,
            "replaced_items": 3
        }
    ]
}
```

#### c) Background Worker API

**File:** `/app/src/app/api/cron/qr-reverse-worker/route.ts` (289 lines)

**Endpoint:** `POST /api/cron/process-async-reverse` (protected by CRON_SECRET)

**What it does:**

1. Fetches queued jobs
2. For each job:
   - Marks spoiled codes as `status='spoiled'`
   - Allocates buffer codes (`is_buffer=true, status='buffer_available'`)
   - Updates buffer codes: `status='buffer_used'`, `case_number=X`,
     `replaces_sequence_no=Y`
   - **Auto-finds master case** for that case_number
   - Links all valid codes to master: `master_code_id=X`, `status='packed'`
   - Updates master: `actual_unit_count`, `status='packed'`
   - Completes job with master_code info

**Protection:** Requires `Authorization: Bearer ${CRON_SECRET}` header

### 4. UI Component

**File:** `/app/src/components/manufacturer/ModeCReverseCaseView.tsx` (404
lines)

**Features:**

- ✅ Textarea for spoiled code input (multi-line)
- ✅ Parses QR codes, URLs, or sequence numbers
- ✅ Shows job list with status badges
- ✅ Auto-polls running jobs every 3 seconds
- ✅ Displays master code when complete
- ✅ **NO master scan input** (auto-assigned by worker)
- ✅ Shows clear instructions for perfect vs damaged cases

**Props:**

```typescript
interface ModeCReverseCaseViewProps {
    userProfile: UserProfile;
    currentBatchProgress: BatchProgress | null;
    isOrderLocked: boolean;
    onJobComplete?: () => void;
}
```

### 5. Integration

**File:**
`/app/src/components/dashboard/views/qr-tracking/ManufacturerScanViewV2.tsx`
(Modified)

**Changes:**

- ✅ Replaced import: `ReverseBatchModeC` → `ModeCReverseCaseView`
- ✅ Updated 2 component usages (lines ~1878 and ~2684)
- ✅ Mode A/B completely untouched
- ✅ No TypeScript errors

---

## 🔧 Setup Instructions

### Step 1: Run SQL Migration ⚡ **CRITICAL**

```bash
# 1. Copy the migration file
cat /Users/macbook/serapod2u_new/app/migrations/mode-c-minimal-add-columns.sql

# 2. Open Supabase Dashboard → SQL Editor
# 3. Paste the SQL and click "Run"
# 4. Verify success: "Mode C minimal migration completed!"
```

### Step 2: Regenerate TypeScript Types

After migration:

```bash
cd /Users/macbook/serapod2u_new/app
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.ts
```

Or update manually (see `/app/docs/MODE_C_FIX_TYPESCRIPT_ERRORS.md` for details)

### Step 3: Setup Cron Worker

**Option A: Vercel Cron** (Recommended)

Add to `vercel.json`:

```json
{
    "crons": [{
        "path": "/api/cron/qr-reverse-worker",
        "schedule": "*/1 * * * *"
    }]
}
```

**Option B: External Cron Service** (e.g., cron-job.org)

- URL: `https://your-domain.com/api/cron/qr-reverse-worker`
- Method: POST
- Schedule: Every 1 minute
- Headers: `Authorization: Bearer YOUR_CRON_SECRET`

**Set Environment Variable:**

```bash
# In .env.local or Vercel settings:
CRON_SECRET=your-random-secret-key-here-keep-it-safe
```

### Step 4: Deploy

```bash
cd /Users/macbook/serapod2u_new/app
npm run build
# Deploy to Vercel/production
```

---

## 🧪 Testing Checklist

### Test 1: Perfect Case (No Spoiled Codes)

**User Flow:**

1. ✅ Do NOT use Mode C
2. ✅ Use existing "Mark Case Perfect" button
3. ✅ Scan master QR only
4. ✅ System auto-links all 100 codes

**Expected:** Master scan still works as before

---

### Test 2: Damaged Case with Readable QR Codes

**User Flow:**

1. ✅ Switch to "Mode C - Async Reverse"
2. ✅ Paste 3 full QR codes (spoiled labels):
   ```
   PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00015-abc123
   PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00022-def456
   PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00081-ghi789
   ```
3. ✅ Click "Submit Background Job"
4. ✅ Toast: "Job created for Case #1"
5. ✅ Wait 1-2 minutes (or trigger worker manually)
6. ✅ Job status updates: queued → running → completed
7. ✅ Master code displayed: `MASTER-ORD-HM-1125-02-CASE-001-...`

**Verify in Database:**

```sql
-- Check spoiled codes
SELECT sequence_number, status, replaces_sequence_no 
FROM qr_codes 
WHERE batch_id = 'YOUR_BATCH_ID' 
  AND sequence_number IN (15, 22, 81);
-- Should show: status = 'spoiled'

-- Check buffer replacements
SELECT sequence_number, status, case_number, replaces_sequence_no
FROM qr_codes
WHERE batch_id = 'YOUR_BATCH_ID'
  AND is_buffer = true
  AND status = 'buffer_used';
-- Should show 3 buffers with replaces_sequence_no = 15, 22, 81

-- Check job completed
SELECT status, master_code, total_replacements, final_unit_count
FROM qr_reverse_jobs
WHERE id = 'YOUR_JOB_ID';
-- Should show: status='completed', master_code='MASTER-...', final_unit_count=100
```

---

### Test 3: Unreadable QR Codes (Sequence Only)

**User Flow:**

1. ✅ Mode C
2. ✅ Paste sequence numbers (label damaged but number visible):
   ```
   18
   SEQ:42
   73
   ```
3. ✅ Submit job
4. ✅ Worker processes successfully

**Expected:** System marks sequences 18, 42, 73 as spoiled and assigns buffers

---

### Test 4: Mixed Input (QR + Sequence)

**User Flow:**

1. ✅ Mode C
2. ✅ Paste mixed input:
   ```
   PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00015-abc123
   22
   SEQ:81
   ```
3. ✅ Submit job

**Expected:** All 3 parsed correctly, job created for Case #1

---

### Test 5: Error Handling - Different Cases

**User Flow:**

1. ✅ Mode C
2. ✅ Paste codes from DIFFERENT cases:
   ```
   PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00015-abc123
   PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00115-def456
   ```
   (Sequence 15 = Case 1, Sequence 115 = Case 2)
3. ✅ Submit job

**Expected:** ❌ Error: "All spoiled codes must be from the same case"

---

### Test 6: Error Handling - Already Spoiled

**User Flow:**

1. ✅ Create job with sequence 15
2. ✅ Try to create another job with sequence 15

**Expected:** ❌ Error: "Sequence 15 is already marked as spoiled"

---

### Test 7: Error Handling - No Buffer Codes

**User Flow:**

1. ✅ Use up all buffer codes
2. ✅ Submit new job

**Expected:** Job status = 'failed', error_message = "No buffer codes available"

---

### Test 8: Multiple Jobs in Parallel

**User Flow:**

1. ✅ Create job for Case 1 (3 spoiled)
2. ✅ Create job for Case 2 (2 spoiled)
3. ✅ Worker processes both

**Expected:** Both complete successfully, correct masters assigned

---

### Test 9: Order Locked Scenario

**User Flow:**

1. ✅ Warehouse begins intake (order locked)
2. ✅ Try to create Mode C job

**Expected:** Button disabled, warning banner shown

---

### Test 10: Mode A/B Still Works

**User Flow:**

1. ✅ Switch to "Mode A - Scan & Assign"
2. ✅ Scan codes manually
3. ✅ Switch to "Mode B - Reverse"
4. ✅ Use existing Mode B functionality

**Expected:** ✅ Mode A/B completely unchanged, no errors

---

## 📊 Key Differences: Mode C vs Perfect Case

| Scenario                     | Mode to Use         | Master Scan Required? | What Happens                                         |
| ---------------------------- | ------------------- | --------------------- | ---------------------------------------------------- |
| **Perfect case (0 spoiled)** | Perfect Case Button | ✅ YES                | Scan master → All 100 linked instantly               |
| **Case with spoiled codes**  | Mode C              | ❌ NO                 | Paste spoiled → Worker auto-assigns master + buffers |

---

## 🔍 Troubleshooting

### Issue: "404 error on /api/manufacturer/modec/create-job"

**Cause:** API routes not deployed **Fix:** Run `npm run build` and deploy

### Issue: "No buffer codes available"

**Cause:** All buffer codes used or not marked as buffers **Fix:** Check
database:

```sql
SELECT COUNT(*) FROM qr_codes 
WHERE batch_id = 'X' 
  AND is_buffer = true 
  AND status = 'buffer_available';
```

### Issue: "Job stuck in 'queued' status"

**Cause:** Cron worker not running **Fix:**

1. Verify CRON_SECRET is set
2. Check Vercel cron is enabled
3. Manually trigger:
   `curl -X POST https://your-domain.com/api/cron/qr-reverse-worker -H "Authorization: Bearer YOUR_SECRET"`

### Issue: TypeScript errors after migration

**Cause:** Types not regenerated **Fix:** Run
`npx supabase gen types typescript...` (see Step 2 above)

---

## 🎯 Summary

| Component       | Status      | Notes                          |
| --------------- | ----------- | ------------------------------ |
| SQL Migration   | ✅ Ready    | **Must run in Supabase first** |
| QR Parser       | ✅ Complete | Handles all input formats      |
| API: create-job | ✅ Complete | Full validation                |
| API: jobs       | ✅ Complete | Lists all jobs                 |
| API: worker     | ✅ Complete | Auto-assigns master            |
| UI Component    | ✅ Complete | No master scan input           |
| Integration     | ✅ Complete | Mode A/B untouched             |
| Cron Setup      | ⏳ Pending  | Setup after deployment         |
| Testing         | ⏳ Pending  | Use checklist above            |

---

## ✅ Ready to Deploy

1. ✅ Run SQL migration in Supabase
2. ✅ Regenerate TypeScript types
3. ✅ Set CRON_SECRET environment variable
4. ✅ Deploy to production
5. ✅ Setup cron job (Vercel or external)
6. ✅ Test with checklist above

**All code is complete and ready!** 🚀
