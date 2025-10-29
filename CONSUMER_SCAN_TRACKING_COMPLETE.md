# Consumer QR Scan Tracking Implementation - COMPLETE ✅

## Overview
Implemented comprehensive consumer scan tracking to distinguish between **manufacturer scans** (supply chain events) and **consumer scans** (end-user engagement with Journey Builder).

## Problem Statement
The "Scanned" metric in Journey Builder statistics was showing **manufacturer scans** (packed/shipped status, e.g., 100 codes) instead of **consumer scans** (actual users viewing the journey and collecting points).

## Solution Architecture

### 1. Database Schema - Consumer Tracking Table

**File:** `migrations/consumer_qr_scans_tracking.sql`

Created `consumer_qr_scans` table to track consumer interactions:

```sql
CREATE TABLE consumer_qr_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_code_id UUID REFERENCES qr_codes(id) ON DELETE CASCADE,
  consumer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  journey_config_id UUID REFERENCES journey_configurations(id),
  scanned_at TIMESTAMPTZ DEFAULT NOW(),
  collected_points BOOLEAN DEFAULT FALSE,
  entered_lucky_draw BOOLEAN DEFAULT FALSE,
  redeemed_gift BOOLEAN DEFAULT FALSE,
  shop_id UUID REFERENCES shops(id),
  points_collected_at TIMESTAMPTZ,
  points_amount INTEGER,
  ip_address TEXT,
  user_agent TEXT,
  location JSONB
)
```

**Key Features:**
- Tracks anonymous scans (consumer_id can be NULL)
- Records journey interactions (points, lucky draw, redemption)
- Stores metadata (IP, user agent, location)
- Links to shop when user logs in to collect points

**Indexes for Performance:**
```sql
CREATE INDEX idx_consumer_scans_qr_code ON consumer_qr_scans(qr_code_id);
CREATE INDEX idx_consumer_scans_consumer ON consumer_qr_scans(consumer_id);
CREATE INDEX idx_consumer_scans_journey ON consumer_qr_scans(journey_config_id);
CREATE INDEX idx_consumer_scans_scanned_at ON consumer_qr_scans(scanned_at);
CREATE INDEX idx_consumer_scans_shop ON consumer_qr_scans(shop_id);
```

### 2. Enhanced QR Codes Table

Added consumer tracking columns to `qr_codes`:
- `first_consumer_scan_at` - First time a consumer scanned this code
- `total_consumer_scans` - Total number of consumer scans

**Auto-update Trigger:**
```sql
CREATE TRIGGER trigger_update_qr_code_consumer_scan
  AFTER INSERT ON consumer_qr_scans
  FOR EACH ROW
  EXECUTE FUNCTION update_qr_code_consumer_scan();
```

### 3. Database RPC Function

**Function:** `get_consumer_scan_stats(p_order_id UUID)`

Returns aggregated statistics:
```sql
{
  unique_consumer_scans: INTEGER,
  total_scans: INTEGER,
  points_collected_count: INTEGER,
  total_points_collected: INTEGER,
  lucky_draw_entries: INTEGER,
  redemptions: INTEGER,
  authenticated_scans: INTEGER,
  anonymous_scans: INTEGER
}
```

### 4. Row-Level Security (RLS) Policies

```sql
-- Public can insert anonymous scans
CREATE POLICY "Allow public insert consumer scans"
  ON consumer_qr_scans FOR INSERT
  TO public WITH CHECK (true);

-- Users can view their own scans
CREATE POLICY "Users can view own scans"
  ON consumer_qr_scans FOR SELECT
  TO authenticated
  USING (consumer_id = auth.uid());

-- Admins can view all scans
CREATE POLICY "Admins can view all scans"
  ON consumer_qr_scans FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('admin', 'super_admin')
    )
  );
```

## API Endpoints

### 1. Track Consumer Scan API

**File:** `app/src/app/api/consumer/track-scan/route.ts`

**Endpoint:** `POST /api/consumer/track-scan`

**Purpose:** Record when consumers scan QR codes and interact with journey features

**Request Body:**
```json
{
  "qr_code": "PROD-XXX-XXX-XXX",
  "action": "view_journey" | "collect_points" | "lucky_draw" | "redeem",
  "points_amount": 10,
  "shop_id": "uuid"
}
```

**Features:**
- Tracks both anonymous and authenticated users
- Records IP address and user agent
- Handles multiple interaction types
- Returns scan history for the QR code

**GET Endpoint:** `GET /api/consumer/track-scan?qr_code=XXX`
- Returns all scan records for a specific QR code
- Useful for analytics and verification

### 2. Updated Journey Stats API

**File:** `app/src/app/api/journey/qr-stats/route.ts`

**Changes:**
- **BEFORE:** Counted `qr_codes.status IN ('packed', 'shipped_distributor', ...)`
- **AFTER:** Counts unique QR codes in `consumer_qr_scans` table

**New Query Logic:**
```typescript
// Get unique QR codes scanned by consumers
const { data: consumerScans } = await supabase
  .from('consumer_qr_scans')
  .select('qr_code_id')
  .in('qr_code_id', qrCodeIds)

// Count unique QR codes
uniqueConsumerScans = new Set(consumerScans.map(s => s.qr_code_id)).size
```

**Returns:**
```json
{
  "total_valid_links": 100,      // Total QR codes generated
  "links_scanned": 15,            // Unique QR codes scanned by consumers
  "lucky_draw_entries": 8,        // Lucky draw entries
  "redemptions": 3,               // Redemptions
  "points_collected": 150         // Total points collected
}
```

## Frontend Integration

### Public Journey View Component

**File:** `app/src/components/journey/PublicJourneyView.tsx`

**Added:** `useEffect` hook to track consumer scans on page load

```typescript
useEffect(() => {
  const trackConsumerScan = async () => {
    if (
      verificationResult.success && 
      verificationResult.data?.is_valid && 
      !verificationResult.data?.is_blocked
    ) {
      await fetch('/api/consumer/track-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qr_code: code,
          action: 'view_journey',
        }),
      })
    }
  }
  trackConsumerScan()
}, [code, verificationResult])
```

**Behavior:**
- Automatically tracks when consumer loads the journey page
- Only tracks for valid, non-blocked codes
- Fails silently to not disrupt user experience
- Records anonymous scans (no login required for viewing)

## Data Flow

### 1. Consumer Scans QR Code
```
User → Scan QR → /verify/[code] → PublicJourneyView loads
                                ↓
                    POST /api/consumer/track-scan
                                ↓
                    INSERT INTO consumer_qr_scans
                                ↓
                    Trigger updates qr_codes.total_consumer_scans
```

### 2. Admin Views Statistics
```
Admin → Journey Builder Dashboard → JourneyCardWithStats
                                   ↓
                    GET /api/journey/qr-stats?order_id=xxx
                                   ↓
            Query consumer_qr_scans (count unique QR codes)
                                   ↓
                    Display "Scanned: 15" (consumer scans, not manufacturer scans)
```

### 3. Consumer Collects Points
```
User → Login to Shop → Click "Collect Points"
                      ↓
        POST /api/consumer/track-scan
        {
          action: 'collect_points',
          shop_id: 'xxx',
          points_amount: 10
        }
                      ↓
        UPDATE consumer_qr_scans
        SET collected_points = TRUE,
            consumer_id = auth.uid(),
            shop_id = xxx,
            points_collected_at = NOW()
```

## Metrics Clarification

| Metric | OLD Source (Wrong) | NEW Source (Correct) |
|--------|-------------------|----------------------|
| **Valid Links** | `qr_batches.total_unique_codes` | Same ✅ |
| **Scanned** | `qr_codes.status IN ('packed', 'shipped')` ❌ | `COUNT(DISTINCT consumer_qr_scans.qr_code_id)` ✅ |
| **Lucky Draw** | `lucky_draw_entries` | Same ✅ |
| **Redemptions** | `consumer_redemption_transactions` | Same ✅ |
| **Points** | `consumer_points_transactions` | Same ✅ |

**Key Difference:**
- **Manufacturer Scans:** Supply chain events (packed by warehouse, shipped to distributor) - tracked via `qr_codes.status`
- **Consumer Scans:** End-user engagement (viewed journey, collected points) - tracked via `consumer_qr_scans` table

## Example Scenario

**Order:** HM-1025-01
- **Generated:** 100 QR codes
- **Packed:** 100 codes (manufacturer scan)
- **Shipped:** 100 codes (manufacturer scan)

**OLD Statistics (Wrong):**
- Valid Links: 100
- Scanned: 100 ❌ (counting manufacturer scans)

**NEW Statistics (Correct):**
- Valid Links: 100
- Scanned: 15 ✅ (only 15 consumers actually scanned and viewed journey)
- Points Collected: 10 (consumers who logged in and collected points)
- Lucky Draw: 8 (consumers who entered lucky draw)
- Redemptions: 3 (consumers who redeemed gifts)

## Deployment Checklist

- [x] Created migration file: `migrations/consumer_qr_scans_tracking.sql`
- [x] Created track-scan API endpoint
- [x] Updated qr-stats API to use consumer scans
- [x] Added consumer scan tracking to PublicJourneyView
- [x] Fixed TypeScript compilation errors
- [ ] **NEXT:** Run migration in Supabase SQL Editor
- [ ] **NEXT:** Test consumer scan tracking in development
- [ ] **NEXT:** Verify statistics show correct counts
- [ ] **NEXT:** Test point collection flow with shop login
- [ ] **NEXT:** Deploy to production

## Migration Execution Steps

1. **Open Supabase Dashboard** → SQL Editor
2. **Copy contents** of `migrations/consumer_qr_scans_tracking.sql`
3. **Paste and Run** the SQL
4. **Verify:**
   ```sql
   -- Check table created
   SELECT * FROM consumer_qr_scans LIMIT 1;
   
   -- Check RPC function exists
   SELECT get_consumer_scan_stats('00000000-0000-0000-0000-000000000000');
   
   -- Check trigger exists
   SELECT * FROM pg_trigger WHERE tgname = 'trigger_update_qr_code_consumer_scan';
   ```

## Testing Plan

### Test 1: Anonymous Consumer Scan
1. Scan QR code (not logged in)
2. Verify record in `consumer_qr_scans` with `consumer_id = NULL`
3. Check `qr_codes.total_consumer_scans` incremented

### Test 2: Journey Statistics
1. Generate QR codes for order
2. Have consumers scan QR codes
3. Check Journey Builder dashboard
4. Verify "Scanned" shows consumer scan count (not manufacturer count)

### Test 3: Point Collection
1. Consumer views journey (anonymous)
2. Consumer clicks "Collect Points"
3. Consumer logs in to shop
4. Verify `consumer_qr_scans` updated with:
   - `consumer_id` = user ID
   - `collected_points` = TRUE
   - `shop_id` = shop ID
   - `points_collected_at` = timestamp

### Test 4: Multiple Scans Same QR
1. Consumer scans same QR code 3 times
2. Verify 3 records in `consumer_qr_scans`
3. Verify statistics count as 1 unique QR code scanned

## Impact Analysis

**Before Implementation:**
- ✅ Could track manufacturer supply chain (packed, shipped)
- ❌ Could NOT track consumer engagement
- ❌ "Scanned" metric was misleading (showed supply chain, not consumer activity)
- ❌ No way to measure actual consumer reach

**After Implementation:**
- ✅ Separate tracking for manufacturer vs consumer
- ✅ Accurate consumer engagement metrics
- ✅ Anonymous scan tracking (privacy-friendly)
- ✅ Authenticated point collection tracking
- ✅ Complete analytics for consumer journey
- ✅ Can measure conversion funnel: Scanned → Points → Lucky Draw → Redemptions

## Files Changed

1. **migrations/consumer_qr_scans_tracking.sql** (NEW)
   - 200+ lines
   - Complete database schema

2. **app/src/app/api/consumer/track-scan/route.ts** (NEW)
   - POST: Record consumer scans
   - GET: Retrieve scan history

3. **app/src/app/api/journey/qr-stats/route.ts** (MODIFIED)
   - Changed from manufacturer to consumer scans
   - Fixed TypeScript errors

4. **app/src/components/journey/PublicJourneyView.tsx** (MODIFIED)
   - Added useEffect to track scans on page load

## Next Steps

1. **Run Migration:** Execute SQL in Supabase
2. **Test Flow:** Scan QR → Verify tracking → Check statistics
3. **Point Collection:** Implement shop login flow for point collection
4. **Analytics Dashboard:** Build consumer engagement analytics
5. **Documentation:** Update user guide with new metrics

## Notes

- Consumer scans are tracked even for anonymous users (privacy-friendly)
- Trigger auto-updates `qr_codes.total_consumer_scans` for quick lookups
- RPC function provides optimized aggregation for large datasets
- RLS policies ensure privacy (users see own scans, admins see all)
- Fails gracefully if tracking API is down (doesn't block user experience)

---

**Status:** ✅ READY FOR MIGRATION AND TESTING
**Date:** 2024
**Issue:** Consumer vs Manufacturer Scan Tracking
**Resolution:** Separate tables and tracking mechanisms
