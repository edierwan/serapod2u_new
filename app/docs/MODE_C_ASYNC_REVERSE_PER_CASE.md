# Mode C: Async Reverse per Case - Implementation Guide

## Overview

Complete redesign of Mode C to simplify the reverse batch process:

- **No product/case selection** - System auto-detects from QR codes
- **No manual master scan** - System auto-assigns master QR
- **Per-case processing** - Each job processes one case at a time
- **Buffer replacement** - Automatically replaces spoiled codes with buffer pool
- **Unreadable QR support** - Can enter just sequence number (e.g., "15")

## Database Changes

### 1. Extended `qr_codes` Table

```sql
-- New columns added:
- case_number integer          -- Which case (1, 2, 3, ...)
- is_buffer boolean            -- True for buffer pool (sequences 3001-3100)
- replaces_sequence_no integer -- Which spoiled sequence this buffer replaces
- variant_key text             -- Quick lookup: "PROD-CELVA9464-CRA-843412"

-- New statuses added:
- 'available'        -- Available for use
- 'used_ok'          -- Used in case, good condition
- 'spoiled'          -- Original label spoiled/damaged
- 'buffer_available' -- Buffer not used yet
- 'buffer_used'      -- Buffer assigned as replacement
```

### 2. New `qr_reverse_jobs` Table

```sql
CREATE TABLE qr_reverse_jobs (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  product_variant_key text NOT NULL,  -- Auto-detected from first QR
  case_number integer NOT NULL,        -- Auto-calculated from sequences
  expected_units_per_case integer,
  
  status text NOT NULL,                -- queued | running | completed | failed
  total_spoiled integer DEFAULT 0,
  total_replacements integer DEFAULT 0,
  
  master_code_id uuid,                 -- Auto-assigned master
  master_code text,                    -- Master QR code string
  final_unit_count integer,            -- Final count after replacements
  
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text
);
```

### 3. New `qr_reverse_job_items` Table

```sql
CREATE TABLE qr_reverse_job_items (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL,
  
  spoiled_code_id uuid,              -- Original spoiled code
  spoiled_sequence_no integer NOT NULL,
  
  replacement_code_id uuid,          -- Buffer code allocated
  replacement_sequence_no integer,
  
  status text NOT NULL,              -- pending | replaced | failed | skipped
  error_message text,
  
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz
);
```

## User Experience Changes

### Before (Complex):

1. Select product variant from dropdown
2. Select case numbers to process
3. Paste exclude codes
4. Wait for job
5. **Manually scan master QR**
6. Link codes

### After (Simple):

1. Paste spoiled codes (or just sequence numbers)
2. Submit job
3. **Done!** System auto-assigns master QR and displays it

## Input Formats Supported

Users can paste any mix of these formats:

```
1. Full tracking URL:
   http://serapod2u.com/track/product/PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00015

2. Raw QR code:
   PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00015

3. Just sequence number (for unreadable QRs):
   15
```

System automatically:

- Parses all formats
- Detects product variant from first valid QR
- Calculates case number (e.g., seq 115 → case 2)
- Validates all codes are from same case
- Finds matching buffer codes
- Assigns master QR

## Architecture

### 1. Submit Job API

**Endpoint:** `POST /api/manufacturer/async-reverse/submit-job`

**Request:**

```json
{
  "batch_id": "uuid",
  "order_id": "uuid",
  "spoiled_inputs": [
    "PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00015",
    "http://serapod2u.com/track/product/PROD-...-00023",
    "47"
  ],
  "created_by": "uuid"
}
```

**Process:**

1. Parse each input line
2. Extract sequence numbers
3. Lookup first valid QR to get variant_key
4. Calculate case_number from sequences
5. Validate all sequences are from same case
6. Create `qr_reverse_jobs` record (status: 'queued')
7. Create `qr_reverse_job_items` for each spoiled code
8. Return job_id

**Response:**

```json
{
  "success": true,
  "job_id": "uuid",
  "case_number": 2,
  "total_spoiled": 3,
  "product_variant_key": "PROD-CELVA9464-CRA-843412"
}
```

### 2. Job Status API

**Endpoint:** `GET /api/manufacturer/async-reverse/job-status?job_id=uuid`

**Response (Running):**

```json
{
  "job_id": "uuid",
  "status": "running",
  "case_number": 2,
  "total_spoiled": 3
}
```

**Response (Completed):**

```json
{
  "job_id": "uuid",
  "status": "completed",
  "case_number": 2,
  "total_spoiled": 3,
  "total_replacements": 3,
  "master_code": "MASTER-CELVA9464-CRA-843412-CASE-002",
  "final_unit_count": 100
}
```

### 3. Background Worker

**Endpoint:** `POST /api/cron/process-async-reverse`

**Protected by:** `CRON_SECRET` env variable

**Process:**

```
FOR EACH queued job:
  1. Mark job as 'running'
  
  2. FOR EACH spoiled sequence:
     a. Find original qr_codes row
     b. Mark as status = 'spoiled'
     c. Find available buffer code (is_buffer = true, status = 'buffer_available')
     d. Mark buffer as status = 'buffer_used'
     e. Set buffer.case_number = job.case_number
     f. Set buffer.replaces_sequence_no = spoiled_sequence_no
     g. Update qr_reverse_job_items with replacement_code_id
  
  3. Auto-assign master case:
     a. Find qr_master_codes WHERE order_id, case_number matches
     b. Count all codes WHERE case_number = X AND status IN ('used_ok', 'buffer_used')
     c. Update master_code.actual_unit_count = count
     d. If count >= expected → status = 'packed'
  
  4. Update job:
     a. Set master_code_id, master_code, final_unit_count
     b. Set status = 'completed'
     c. Set completed_at = now()
```

## Migration Steps

### 1. Run SQL Migration

```bash
# Copy contents of: /app/migrations/mode-c-async-reverse-per-case.sql
# Paste in Supabase SQL Editor
# Execute
```

This will:

- Add columns to `qr_codes` table
- Create `qr_reverse_jobs` table
- Create `qr_reverse_job_items` table
- Add helper functions and triggers
- Create monitoring view

### 2. Replace Component

```bash
# Backup old component
mv ReverseBatchModeC.tsx ReverseBatchModeC-OLD.tsx

# Use new simplified component
mv ReverseBatchModeC-NEW.tsx ReverseBatchModeC.tsx
```

### 3. Create API Routes

Need to create these 3 files:

1. `/app/src/app/api/manufacturer/async-reverse/submit-job/route.ts`
2. `/app/src/app/api/manufacturer/async-reverse/job-status/route.ts`
3. `/app/src/app/api/cron/process-async-reverse/route.ts`

### 4. Update TypeScript Types

Add to `/app/src/types/database.ts`:

```typescript
qr_codes: {
  Row: {
    // ... existing fields
    case_number: number | null;
    is_buffer: boolean;
    replaces_sequence_no: number | null;
    variant_key: string | null;
  }
}

qr_reverse_jobs: {
  Row: {
    id: string;
    order_id: string;
    batch_id: string;
    product_variant_key: string;
    case_number: number;
    expected_units_per_case: number;
    status: "queued" | "running" | "completed" | "failed";
    total_spoiled: number;
    total_replacements: number;
    master_code_id: string | null;
    master_code: string | null;
    final_unit_count: number | null;
    created_by: string;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
    error_message: string | null;
  }
}

qr_reverse_job_items: {
  Row: {
    id: string;
    job_id: string;
    spoiled_code_id: string | null;
    spoiled_sequence_no: number;
    replacement_code_id: string | null;
    replacement_sequence_no: number | null;
    status: "pending" | "replaced" | "failed" | "skipped";
    error_message: string | null;
    created_at: string;
    processed_at: string | null;
  }
}
```

## Testing Checklist

- [ ] Run migration successfully
- [ ] UI shows "Paste Spoiled Codes" textarea
- [ ] Can paste full QR URL
- [ ] Can paste raw QR code
- [ ] Can paste just sequence number
- [ ] System detects product variant automatically
- [ ] System calculates case number correctly
- [ ] Error shown if codes from multiple cases
- [ ] Job submits successfully
- [ ] Job status polls every 3 seconds
- [ ] Job shows running status
- [ ] Job completes and shows master QR
- [ ] Master QR is auto-assigned (no manual scan)
- [ ] Final unit count is correct
- [ ] Buffer codes were used
- [ ] Worker processes job in background

## Key Benefits

1. **Simpler UX** - No dropdowns, no manual scans
2. **Faster** - Operator just pastes spoiled codes
3. **Flexible Input** - URLs, QR codes, or sequence numbers
4. **Auto-Detection** - System figures out variant and case
5. **Auto-Assignment** - No manual master QR scan needed
6. **Buffer Logic** - Automatic replacement from buffer pool
7. **Per-Case** - Clean separation, one job per case
8. **Unreadable QR** - Can enter sequence number manually

## Example Workflow

```
Operator has Case #2 (sequences 101-200):
- 3 codes are damaged: #115, #147, #182

Step 1: Paste into textarea:
115
147
182

Step 2: Click "Submit Background Job"

Step 3: System automatically:
- Detects variant: PROD-CELVA9464-CRA-843412
- Calculates case: #2 (because 115, 147, 182 all in 101-200 range)
- Finds 3 buffer codes from pool (3001-3100)
- Marks #115, #147, #182 as 'spoiled'
- Marks buffer codes as 'buffer_used' and assigns to case #2
- Updates master case actual_unit_count = 100
- Returns master QR: MASTER-CELVA9464-CRA-843412-CASE-002

Step 4: UI shows:
✅ Job Complete - Master QR Auto-Assigned
Master Case QR: MASTER-CELVA9464-CRA-843412-CASE-002
Case Number: #2
Final Unit Count: 100 units
Spoiled Codes: 3
Buffer Replacements: 3
```

## Files Changed

1. ✅ `/app/migrations/mode-c-async-reverse-per-case.sql` (NEW)
2. ⏳ `/app/src/components/dashboard/views/qr-tracking/ReverseBatchModeC.tsx`
   (Replace)
3. ⏳ `/app/src/types/database.ts` (Extend)
4. ⏳ `/app/src/app/api/manufacturer/async-reverse/submit-job/route.ts` (NEW)
5. ⏳ `/app/src/app/api/manufacturer/async-reverse/job-status/route.ts` (NEW)
6. ⏳ `/app/src/app/api/cron/process-async-reverse/route.ts` (NEW)

## Next Steps

1. **Run the migration** in Supabase SQL Editor
2. **Review and confirm** the schema changes look correct
3. **I'll create the 3 API route files** once migration is confirmed
4. **Replace the component** with the new simplified version
5. **Test end-to-end** with real data

The migration is ready to run - shall I proceed with creating the API routes?
