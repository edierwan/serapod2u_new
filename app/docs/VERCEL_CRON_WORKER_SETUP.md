# Vercel Cron Worker Setup Guide

## Issue
Mode C worker keeps "Running..." on Vercel but doesn't process jobs.

## Root Cause
**The worker only had a POST handler, but Vercel Cron jobs use GET requests.**

---

## ✅ Fix Applied

### 1. Added GET Handler for Vercel Cron
**File**: `/src/app/api/cron/qr-reverse-worker/route.ts`

```typescript
// NEW: GET handler for Vercel Cron
export async function GET(request: NextRequest) {
  console.log('🔔 Cron trigger: GET request from Vercel')
  return processJobs(request)
}

// EXISTING: POST handler for manual testing
export async function POST(request: NextRequest) {
  console.log('🔧 Manual trigger: POST request')
  return processJobs(request)
}
```

### 2. Refactored to Shared Function
Both GET and POST now call the same `processJobs()` function.

### 3. Improved Authorization
```typescript
// Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
// Development: Skip auth check
// Production: Validate CRON_SECRET if provided
```

---

## 🔧 Vercel Configuration Required

### Step 1: Add CRON_SECRET Environment Variable

1. Go to **Vercel Dashboard** → Your Project
2. Go to **Settings** → **Environment Variables**
3. Add new variable:
   - **Name**: `CRON_SECRET`
   - **Value**: Generate a random secret (e.g., `openssl rand -base64 32`)
   - **Environments**: Production, Preview, Development

**Example**:
```bash
# Generate a secure secret
openssl rand -base64 32

# Output: abc123xyz456randomsecrethere==
```

Add this to Vercel:
```
CRON_SECRET=abc123xyz456randomsecrethere==
```

### Step 2: Verify vercel.json Configuration

**File**: `vercel.json`

```json
{
  "buildCommand": "npm run build",
  "installCommand": "npm install",
  "framework": "nextjs",
  "outputDirectory": ".next",
  "crons": [
    {
      "path": "/api/cron/qr-reverse-worker",
      "schedule": "*/1 * * * *"
    }
  ]
}
```

**Schedule**: `*/1 * * * *` = Every 1 minute

### Step 3: Redeploy to Vercel

After adding the environment variable:

```bash
# Option A: Push to trigger auto-deploy
git add .
git commit -m "fix: Add GET handler for Vercel Cron worker"
git push origin main

# Option B: Manual redeploy in Vercel Dashboard
# Go to Deployments → Click "Redeploy"
```

---

## 🧪 Testing

### Test 1: Check Cron is Registered

1. Go to **Vercel Dashboard** → Your Project
2. Go to **Settings** → **Cron Jobs**
3. You should see:
   ```
   Path: /api/cron/qr-reverse-worker
   Schedule: */1 * * * *
   Status: Active
   ```

### Test 2: Manual Trigger (Test GET endpoint)

```bash
# Test on production (requires CRON_SECRET)
curl -X GET https://your-domain.com/api/cron/qr-reverse-worker \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# Expected response:
{
  "success": true,
  "processed": 1,
  "results": [...],
  "duration_ms": 1234
}
```

### Test 3: Check Vercel Logs

1. Go to **Vercel Dashboard** → Your Project
2. Go to **Logs** (or **Deployments** → Click deployment → **Function Logs**)
3. Look for:
   ```
   🔔 Cron trigger: GET request from Vercel
   📋 Found X queued job(s) to process
   ✅ Worker completed: X job(s) in Xms
   ```

### Test 4: Check Job Processing

1. Open your app: `https://your-domain.com`
2. Navigate to: **Manufacturer Scan** page
3. Submit a Mode C job
4. Wait 1-2 minutes
5. Refresh - Status should change from "Queued" to "Running" to "Completed"

---

## 📊 How It Works

### Before Fix:
```
Vercel Cron → GET /api/cron/qr-reverse-worker
                ↓
              ❌ 405 Method Not Allowed (only POST existed)
              
Jobs stay "Queued" forever
```

### After Fix:
```
Vercel Cron → GET /api/cron/qr-reverse-worker
                ↓
              ✅ GET handler exists
                ↓
              processJobs() function
                ↓
              Fetch queued jobs from database
                ↓
              Process each job (spoiled → buffer)
                ↓
              Update job status to "completed"
```

---

## 🔍 Troubleshooting

### Issue: "No queued jobs to process"

**Check**:
1. Are there jobs in the database with status "queued"?
   ```sql
   SELECT * FROM qr_reverse_jobs WHERE status = 'queued';
   ```

2. Did the UI successfully create the job?
   - Check browser console for errors
   - Check Network tab for `/api/manufacturer/modec/create-job` response

### Issue: "Unauthorized" (401)

**Solutions**:
1. **CRON_SECRET mismatch**:
   - Verify CRON_SECRET in Vercel matches what the cron sends
   - Redeploy after changing environment variables

2. **Missing CRON_SECRET**:
   - Add CRON_SECRET to Vercel environment variables
   - Redeploy

### Issue: Jobs stuck in "Running"

**Check**:
1. **Worker crashed mid-processing**:
   - Check Vercel function logs for errors
   - Look for timeout errors (Vercel free tier: 10s limit, Pro: 60s)

2. **Timeout exceeded**:
   - If processing 100+ jobs, worker might timeout
   - Reduce batch size in worker:
     ```typescript
     .limit(100) // Change to .limit(10) for testing
     ```

### Issue: Cron not triggering

**Check**:
1. **Cron job not registered**:
   - Verify `vercel.json` has correct `crons` array
   - Check Vercel Dashboard → Settings → Cron Jobs

2. **Free tier limitation**:
   - Vercel free tier: 1 cron job, runs less frequently
   - Upgrade to Pro for more frequent runs

3. **Region issue**:
   - Cron runs in specific regions
   - Check Vercel logs to see if it's running at all

---

## 🚀 Expected Behavior After Fix

### Step 1: User Submits Job
- UI sends POST to `/api/manufacturer/modec/create-job`
- Job created with status "queued"
- UI shows "Queued (1 job) • Cases #3-3"

### Step 2: Vercel Cron Triggers (Every 1 Minute)
- Vercel sends GET to `/api/cron/qr-reverse-worker`
- Worker fetches all "queued" jobs
- Updates status to "running"

### Step 3: Worker Processes Job
- Validates master codes exist
- Links spoiled codes to buffers
- Updates counts and status
- Marks job as "completed"

### Step 4: UI Updates
- User clicks refresh or auto-refresh triggers
- Job status changes from "Queued" → "Completed"
- Shows results: "Spoiled: 5 | Replaced: 5"

**Total time**: 1-3 minutes (depending on cron timing)

---

## 📈 Performance Metrics

### Expected Processing Time:
- **Per case**: <4 seconds (with batch optimizations)
- **100 jobs**: ~6-10 minutes (10 jobs per cron run × 10 runs)
- **450 jobs**: ~30-45 minutes

### Cron Frequency:
- **Setting**: Every 1 minute (`*/1 * * * *`)
- **Actual**: May run every 1-2 minutes on free tier
- **Pro tier**: More consistent 1-minute intervals

---

## 🔐 Security Notes

### CRON_SECRET:
- **Purpose**: Prevent unauthorized access to worker endpoint
- **Format**: `Bearer <secret>` in Authorization header
- **Generation**: Use cryptographically secure random string
- **Rotation**: Change periodically for security

### Public Endpoint:
- Worker endpoint is public but protected by CRON_SECRET
- Without valid secret, returns 401 Unauthorized
- Development mode skips auth check for local testing

---

## 📝 Deployment Checklist

- [ ] Add CRON_SECRET to Vercel environment variables
- [ ] Verify vercel.json has cron configuration
- [ ] Deploy/redeploy to Vercel
- [ ] Check Vercel Dashboard → Cron Jobs (should show active)
- [ ] Submit test job from UI
- [ ] Wait 1-2 minutes
- [ ] Check Vercel logs for cron trigger
- [ ] Verify job status changed to "completed"
- [ ] Check UI shows results

---

## 🎯 Quick Reference

| Environment | Auth Required | Endpoint | Method |
|-------------|---------------|----------|--------|
| Development | ❌ No | http://localhost:3000/api/cron/qr-reverse-worker | GET or POST |
| Production (Cron) | ✅ Yes (auto) | https://your-domain.com/api/cron/qr-reverse-worker | GET |
| Production (Manual) | ✅ Yes | https://your-domain.com/api/cron/qr-reverse-worker | POST |

### Cron Schedule Options:
```
*/1 * * * *   → Every 1 minute
*/5 * * * *   → Every 5 minutes
0 * * * *     → Every hour
0 0 * * *     → Every day at midnight
```

---

## 🔄 After This Fix

1. ✅ Worker accepts GET requests (Vercel Cron compatible)
2. ✅ Worker accepts POST requests (manual testing)
3. ✅ Proper authorization with CRON_SECRET
4. ✅ Development mode auth bypass
5. ✅ Detailed logging for debugging

**Status**: Ready for Vercel deployment!
