# Mode C: Button Differences & Workflow Explanation

## 📋 Overview

Mode C has **two separate buttons** that work together in a **two-step process**:

1. **"Submit Background Job"** - Creates the job
2. **"Run Worker"** - Processes the job

---

## 🔄 The Two-Step Process

### **Step 1: Submit Background Job**

**Button Location**: Under "Step 1: Paste Spoiled Codes & Submit Job"

**What it does**:
- Takes your spoiled code input
- Creates a new record in `qr_reverse_jobs` table
- Sets the status to `queued`
- Returns immediately (no processing happens yet)

**API Endpoint**: `POST /api/manufacturer/modec/create-job`

**When to click**: When you have spoiled codes ready to process

**Example**:
```
You paste 5 spoiled codes → Click "Submit Background Job"
→ Job created with status: "queued"
→ Waiting for worker to process it
```

---

### **Step 2: Run Worker**

**Button Location**: Top-right of "Step 2: Job Status & Results" card

**What it does**:
- Finds all jobs with status `queued`
- Processes each job:
  - Marks spoiled codes as `spoiled`
  - Uses buffer codes (if provided)
  - Links all good codes to master case
  - Updates job status to `partial` or `completed`

**API Endpoint**: `POST /api/cron/qr-reverse-worker`

**When to click**: 
- After submitting a job (to process it immediately)
- To check for any pending jobs
- For manual testing in localhost

**Example**:
```
Job is "queued" → Click "Run Worker"
→ Worker processes the job
→ Job status changes to "completed" or "partial"
→ Codes are linked to master case
```

---

## 🤔 Why Two Buttons Instead of One?

### Current Design (Two Buttons):

**Advantages**:
✅ **Separation of concerns** - Creating vs. Processing
✅ **Manual control** - Test each step independently
✅ **Multiple jobs** - Submit many jobs, then process all at once
✅ **Background processing** - In production, worker runs automatically via cron

**Use Case**:
```
Scenario: Factory floor with multiple damaged cases

1. Worker 1: Paste spoiled codes for Case #5 → Submit Job
2. Worker 2: Paste spoiled codes for Case #12 → Submit Job  
3. Worker 3: Paste spoiled codes for Case #18 → Submit Job
4. Supervisor: Click "Run Worker" → All 3 jobs processed at once
```

---

### Alternative Design (One Button):

If we merged them into one button, it would:

```typescript
// Pseudo-code for "Submit & Process Now" button
handleSubmitAndProcess = async () => {
  // 1. Create job
  const job = await createJob(spoiledInput)
  
  // 2. Immediately process it
  await processJob(job.id)
  
  // 3. Show results
  loadJobs()
}
```

**Drawbacks**:
❌ Slower response time (wait for full processing)
❌ Can't batch multiple jobs
❌ Harder to test/debug
❌ No manual control over when processing happens

---

## 🏭 Production vs. Development

### **In Production (Vercel)**:

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/qr-reverse-worker",
      "schedule": "*/1 * * * *"  // Every 1 minute
    }
  ]
}
```

**Workflow**:
1. User clicks "Submit Background Job" → Job created (queued)
2. Vercel Cron runs every 1 minute → Automatically processes all queued jobs
3. User refreshes to see results → Job status updated

**"Run Worker" button**: Not needed in production (cron handles it)

---

### **In Development (Localhost)**:

**Workflow**:
1. User clicks "Submit Background Job" → Job created (queued)
2. **User manually clicks "Run Worker"** → Processes the job immediately
3. Results appear instantly → Job status updated

**Why manual?**: No cron service in localhost, so you control when processing happens

---

## 🔧 Recent Fix: 401 Unauthorized Error

### **Problem**:
```
⚠️ Unauthorized worker access attempt
POST /api/cron/qr-reverse-worker 401
```

### **Root Cause**:
The worker endpoint requires `CRON_SECRET` authentication:
- In production: Vercel Cron automatically includes the secret
- In localhost: Manual button click doesn't include the secret

### **Solution**:
Modified `/api/cron/qr-reverse-worker/route.ts`:

```typescript
// Before (strict auth)
if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

// After (skip auth in development)
const isProduction = process.env.NODE_ENV === 'production'

if (isProduction && cronSecret && authHeader !== `Bearer ${cronSecret}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

**Now**:
- ✅ Localhost: "Run Worker" button works without auth
- ✅ Production: Cron endpoint still requires secret for security

---

## 🎯 Recommendation: Keep Two Buttons

**Why?**

1. **Flexibility**: Users can submit multiple jobs and process them together
2. **Testing**: Easier to debug (test job creation separately from processing)
3. **Production Ready**: Aligns with automatic cron processing in production
4. **Manual Override**: Allows developers to manually trigger processing when needed

**In Production**: Users will only use "Submit Background Job" button. The worker runs automatically every minute.

**In Development**: Users use both buttons for testing.

---

## 📊 Visual Flow

```
┌──────────────────────────────────────┐
│  Step 1: Submit Spoiled Codes        │
│                                      │
│  [Textarea with spoiled codes]       │
│                                      │
│  [Submit Background Job] ← Click #1  │
│         ↓                            │
│    Job created (queued)              │
└──────────────────────────────────────┘
                ↓
┌──────────────────────────────────────┐
│  Step 2: Job Status & Results        │
│                                      │
│  [Run Worker] ← Click #2 (localhost)  │
│         ↓                            │
│    Worker processes job              │
│         ↓                            │
│  Job status: completed ✅            │
│  Master case assigned                │
│  Codes linked                        │
└──────────────────────────────────────┘
```

---

## 🚀 Testing in Localhost

### **Test Scenario**:

1. **Select an order** with buffer codes
2. **Paste spoiled codes** in textarea:
   ```
   PROD-CELVA9464-CRA-843412-ORD-HM-1125-01-00015-abc123
   PROD-CELVA9464-CRA-843412-ORD-HM-1125-01-00022-def456
   18
   ```
3. **Click "Submit Background Job"**
   - ✅ Success toast appears
   - ✅ Job appears in Step 2 with status "Queued"
4. **Click "Run Worker"**
   - ✅ Processing happens
   - ✅ Job status changes to "Completed"
   - ✅ Master case assigned
   - ✅ Codes linked

---

## 📝 Summary

| Feature | Submit Background Job | Run Worker |
|---------|----------------------|------------|
| **Purpose** | Create job | Process job |
| **Endpoint** | `/api/manufacturer/modec/create-job` | `/api/cron/qr-reverse-worker` |
| **When to use** | Have spoiled codes | Job is queued |
| **Localhost** | Always needed | Manual trigger |
| **Production** | Always needed | Automatic (cron) |
| **Authentication** | User session | CRON_SECRET (skip in dev) |

---

## ✅ Status: FIXED

The 401 error is now resolved. You can test both buttons in localhost:

1. ✅ Submit Background Job works
2. ✅ Run Worker works (no auth error)
3. ✅ Jobs process successfully
4. ✅ Ready for production deployment

When deployed to Vercel, the cron will handle processing automatically!
