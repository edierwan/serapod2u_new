# Quick Guide: Run Consumer Scan Tracking Migration

## Migration File
`migrations/consumer_qr_scans_tracking.sql`

## Steps to Execute

### 1. Open Supabase Dashboard
- Go to: https://supabase.com/dashboard
- Select your project
- Navigate to: **SQL Editor**

### 2. Run Migration
1. Click **"New Query"**
2. Open `migrations/consumer_qr_scans_tracking.sql` in VS Code
3. **Copy all contents** (200+ lines)
4. **Paste** into Supabase SQL Editor
5. Click **"Run"** or press `Ctrl+Enter`

### 3. Verify Migration Success

Run these verification queries:

```sql
-- 1. Check table exists
SELECT COUNT(*) FROM consumer_qr_scans;
-- Expected: Should return 0 (empty table)

-- 2. Check columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'consumer_qr_scans';
-- Expected: 15 columns listed

-- 3. Check indexes
SELECT indexname FROM pg_indexes 
WHERE tablename = 'consumer_qr_scans';
-- Expected: 5 indexes

-- 4. Check RPC function
SELECT get_consumer_scan_stats('00000000-0000-0000-0000-000000000000');
-- Expected: Returns JSON with 0 counts

-- 5. Check trigger exists
SELECT tgname FROM pg_trigger 
WHERE tgname = 'trigger_update_qr_code_consumer_scan';
-- Expected: trigger_update_qr_code_consumer_scan

-- 6. Check RLS policies
SELECT policyname FROM pg_policies 
WHERE tablename = 'consumer_qr_scans';
-- Expected: 3 policies
```

### 4. Test Consumer Scan Tracking

After migration, test the flow:

1. **Scan a QR code** (as anonymous user)
   - URL: `https://your-app.com/verify/PROD-XXX-XXX-XXX`
   - Should auto-track scan

2. **Check scan was recorded:**
   ```sql
   SELECT * FROM consumer_qr_scans 
   ORDER BY scanned_at DESC 
   LIMIT 5;
   ```

3. **Check QR code counter updated:**
   ```sql
   SELECT qr_code, total_consumer_scans, first_consumer_scan_at 
   FROM qr_codes 
   WHERE total_consumer_scans > 0;
   ```

4. **Check statistics API:**
   - URL: `https://your-app.com/api/journey/qr-stats?order_id=xxx`
   - Should show `links_scanned` with consumer count

### 5. Common Issues

**Issue: "relation consumer_qr_scans does not exist"**
- Solution: Migration didn't run. Re-run the SQL.

**Issue: "RPC function get_consumer_scan_stats does not exist"**
- Solution: Check if RPC section of migration ran. Run it separately.

**Issue: "permission denied for table consumer_qr_scans"**
- Solution: Check GRANT statements ran. Run:
  ```sql
  GRANT ALL ON consumer_qr_scans TO authenticated;
  GRANT ALL ON consumer_qr_scans TO service_role;
  ```

**Issue: Statistics still show 0 scans**
- Solution: 
  1. Check if migration ran: `SELECT COUNT(*) FROM consumer_qr_scans;`
  2. Scan a QR code to create test data
  3. Check API logs for errors

## Rollback (If Needed)

```sql
-- Drop table (cascades to trigger)
DROP TABLE IF EXISTS consumer_qr_scans CASCADE;

-- Drop RPC function
DROP FUNCTION IF EXISTS get_consumer_scan_stats(UUID);

-- Drop trigger function
DROP FUNCTION IF EXISTS update_qr_code_consumer_scan();

-- Remove columns from qr_codes
ALTER TABLE qr_codes 
  DROP COLUMN IF EXISTS first_consumer_scan_at,
  DROP COLUMN IF EXISTS total_consumer_scans;
```

## Migration Checklist

- [ ] Opened Supabase SQL Editor
- [ ] Copied migration SQL
- [ ] Ran migration successfully
- [ ] Verified table created
- [ ] Verified indexes created
- [ ] Verified RPC function exists
- [ ] Verified trigger exists
- [ ] Verified RLS policies created
- [ ] Tested consumer scan tracking
- [ ] Checked statistics API returns correct data
- [ ] Verified auto-increment on qr_codes.total_consumer_scans

## What This Migration Does

1. **Creates `consumer_qr_scans` table** - Tracks every consumer interaction
2. **Adds columns to `qr_codes`** - Quick lookup for consumer scan counts
3. **Creates trigger** - Auto-updates qr_codes when consumer scans
4. **Creates RPC function** - Aggregates statistics efficiently
5. **Sets up RLS policies** - Privacy and security for consumer data

## After Migration

The system will now:
- ✅ Track anonymous consumer scans (no login required)
- ✅ Track authenticated scans (when user logs in)
- ✅ Separate manufacturer scans (supply chain) from consumer scans (engagement)
- ✅ Show accurate "Scanned" counts in Journey Builder dashboard
- ✅ Enable analytics on consumer behavior (points, lucky draw, redemptions)

---

**Next:** Once migration is complete, test the flow and verify statistics are accurate!
