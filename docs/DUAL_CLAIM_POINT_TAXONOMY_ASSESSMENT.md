# Assessment: Dual-Claim QR Model & Point Taxonomy Standardization

**Date:** 2025-06-07
**Status:** Assessment only — no implementation
**Branch:** staging
**Scope:** Two architectural changes + RoadTour implementation context

---

## Table of Contents

- [A. Executive Summary](#a-executive-summary)
- [B. Current State Inventory](#b-current-state-inventory)
- [C. Change 1 — Dual-Claim QR Model](#c-change-1--dual-claim-qr-model)
- [D. Change 2 — Point Taxonomy Standardization](#d-change-2--point-taxonomy-standardization)
- [E. RoadTour Implementation Context](#e-roadtour-implementation-context)
- [F. Combined Blast Radius](#f-combined-blast-radius)
- [G. Migration Strategy](#g-migration-strategy)

---

## A. Executive Summary

### What we have today
Every QR code can be collected **once** by **one consumer**. The boolean `qr_codes.is_points_collected` is flipped to `true` on first collect. A unique partial index on `consumer_qr_scans` enforces this globally. Points are tracked in two tables (`consumer_qr_scans` for scan-based, `points_transactions` for everything else) unified through views.

### What Change 1 proposes
Allow **two independent claim lanes** per QR: a **shop claim** (shop staff scans on behalf of consumer) and a **consumer claim** (consumer self-scans). Each QR can be collected up to twice — once per lane. Points from each lane may differ.

### What Change 2 proposes
Add four new columns to `points_transactions` to create a **standard taxonomy**:
- `point_category` — what kind of event (scan, roadtour, registration, game, referral, migration, adjustment)
- `point_indicator` — sub-classification within category
- `point_owner_type` — who the point belongs to (consumer, shop, hq)
- `point_direction` — earn or spend

This replaces the current ad-hoc `transaction_type` CHECK constraint for reporting purposes.

### Key risk
The single-collect model is enforced at **three levels**: a boolean flag, a unique index, and an RPC function with `FOR UPDATE` row locking. All three must be redesigned atomically. The blast radius spans **47 TypeScript files** and **4 database views**.

---

## B. Current State Inventory

### B.1 Data Volumes (Staging)

| Table | Rows |
|-------|------|
| `qr_codes` | 1,088,360 |
| `consumer_qr_scans` | 43,489 |
| `points_transactions` | 2,917 |
| `users` | 1,691 |
| `organizations` | 771 |
| `roadtour_scan_events` | 0 |

QR collection rate: 16,964 QRs collected out of 1,088,360 (1.6%).

### B.2 Core Tables

#### `qr_codes` (42 columns, 30 indexes)
Key points-related columns:
```
is_points_collected   boolean    DEFAULT false  — THE single-collect flag
is_redeemed           boolean    DEFAULT false
consumer_phone        text       — set on collection
consumer_name         text       — set on collection
consumer_email        text       — set on collection
points_value          integer    — the points this QR is worth
shop_id               uuid       — FK to organizations
```

Key index:
```sql
idx_qr_codes_status_flags ON (is_redeemed, is_lucky_draw_entered, is_points_collected)
```

#### `consumer_qr_scans` (25 columns)
Key columns:
```
qr_code_id           uuid       FK → qr_codes
consumer_id          uuid       FK → users
shop_id              uuid       FK → organizations
collected_points     boolean    DEFAULT false
points_amount        integer
is_manual_adjustment boolean    DEFAULT false
adjustment_type      text       — 'scan' | 'manual_add' | 'system_collection'
points_collected_at  timestamptz
```

**Critical constraint:**
```sql
CREATE UNIQUE INDEX uq_consumer_qr_scans_qr_collected_once
  ON consumer_qr_scans (qr_code_id)
  WHERE (collected_points = true);
```
This means: for any given `qr_code_id`, only ONE row can have `collected_points = true`. **This is the primary blocker for dual-claim.**

Current distribution of `adjustment_type`: `scan` = 16,964 rows, `manual_add` = 1 row.

#### `points_transactions` (19 columns)
Key columns:
```
user_id              uuid       FK → users
company_id           uuid       FK → organizations
transaction_type     text       — CHECK constraint
points_amount        integer    — positive for earn, negative for spend
balance_after        integer
consumer_phone       text
consumer_email       text
redeem_item_id       uuid       FK → redeem_items
description          text
created_by           uuid
```

**CHECK constraint values:**
```sql
CHECK (transaction_type = ANY(ARRAY[
  'earn', 'redeem', 'expire', 'adjust', 'game_win',
  'MIGRATION', 'registration', 'roadtour', 'roadtour_survey'
]))
```

Current usage: `MIGRATION` = 1,744, `earn` = 1,158, `redeem` = 15. The remaining 6 types (`expire`, `adjust`, `game_win`, `registration`, `roadtour`, `roadtour_survey`) have **zero rows**.

### B.3 Core Functions

#### `consumer_collect_points(p_qr_id, p_consumer_id, p_shop_id, p_points_override, p_journey_config_id)`
This is the **primary collection RPC** called from both `collect-points/route.ts` and `collect-points-auth/route.ts`:

```sql
-- 1. Lock the QR row
SELECT * INTO v_qr FROM public.qr_codes WHERE id = p_qr_id FOR UPDATE;

-- 2. Check single-collect flag
IF v_qr.is_points_collected THEN
  RETURN jsonb_build_object('success', false, 'error', 'already_collected', ...);
END IF;

-- 3. Set flag to TRUE
UPDATE public.qr_codes SET is_points_collected = true, ... WHERE id = p_qr_id;

-- 4. Insert into consumer_qr_scans with collected_points = true
INSERT INTO public.consumer_qr_scans (..., collected_points, adjustment_type, ...)
VALUES (..., true, 'scan', ...);
```

All four steps enforce single-collect semantics. For dual-claim, this function needs a **claim_lane parameter**.

#### `record_roadtour_reward(...)`
Separate path — inserts directly into `points_transactions` with `transaction_type = 'roadtour'` or `'roadtour_survey'`. Does NOT touch `qr_codes.is_points_collected` or `consumer_qr_scans`. Duplicate prevention is via `roadtour_scan_events` table, not the QR flag.

### B.4 Views

#### `v_consumer_points_balance`
Two CTEs:
1. **`scan_points`** — aggregates `consumer_qr_scans WHERE collected_points = true`, splits by `is_manual_adjustment`
2. **`transaction_points`** — aggregates `points_transactions`, splits by `transaction_type` using CASE statements for `redeem`, `adjust`, `MIGRATION`, and everything else as `total_other`

Final balance = `scan earned + manual/adjusted + transaction_points`

**Impact of Change 1:** Must be able to distinguish shop-lane vs consumer-lane points in scan_points CTE.
**Impact of Change 2:** The hardcoded CASE statements on `transaction_type` must be replaced.

#### `shop_points_ledger`
UNION ALL of:
1. `consumer_qr_scans` (scan-based, `WHERE collected_points = true`)
2. `points_transactions` (all non-scan transactions matched to shop via `company_id` or user lookup)

**Impact of Change 1:** The scan half needs a `claim_lane` column or filter.
**Impact of Change 2:** The transaction half references `transaction_type` in CASE logic.

#### `v_shop_points_balance`
Aggregates `shop_points_ledger`, groups by `shop_id`, uses CASE on `transaction_type` for `scan`, `manual`/`adjust`, `redeem`.

#### `v_shop_points_summary`
Wraps `v_consumer_points_balance` with `organizations` join. Inherits all impacts.

---

## C. Change 1 — Dual-Claim QR Model

### C.1 Problem Statement

Currently a QR can only be collected once in total. The business needs two independent collection pathways:

| Lane | Actor | Trigger | Points source |
|------|-------|---------|---------------|
| **Shop claim** | Shop staff | Scans QR at counter | `qr_codes.points_value` or journey config |
| **Consumer claim** | Consumer | Self-scans QR | `qr_codes.points_value` or journey config |

A QR should allow one shop claim AND one consumer claim (max 2 collects). Each lane is independent — a shop claim does not block the consumer from claiming, and vice versa.

### C.2 Schema Changes Required

#### `qr_codes` table

**Option A — Two boolean flags (recommended for simplicity):**
```sql
ALTER TABLE qr_codes ADD COLUMN is_shop_points_collected boolean DEFAULT false;
ALTER TABLE qr_codes ADD COLUMN is_consumer_points_collected boolean DEFAULT false;
-- Deprecate but keep is_points_collected as computed: shop OR consumer
-- Or: ALTER TABLE qr_codes DROP COLUMN is_points_collected; (breaking)
```

**Option B — Enum replacing boolean:**
```sql
ALTER TABLE qr_codes ADD COLUMN points_collection_status text DEFAULT 'none';
-- Allowed: 'none', 'shop_only', 'consumer_only', 'both'
```

**Recommendation:** Option A. Two booleans are easy to index, easy to understand, and maintain backward compat (keep `is_points_collected` as a generated column = `shop OR consumer`).

```sql
-- Backward-compatible generated column
ALTER TABLE qr_codes ADD COLUMN is_shop_points_collected boolean DEFAULT false;
ALTER TABLE qr_codes ADD COLUMN is_consumer_points_collected boolean DEFAULT false;
-- Then migrate: UPDATE qr_codes SET is_consumer_points_collected = is_points_collected;
-- Then: ALTER TABLE qr_codes DROP COLUMN is_points_collected;
--   AND ADD COLUMN is_points_collected boolean GENERATED ALWAYS AS
--     (is_shop_points_collected OR is_consumer_points_collected) STORED;
```

New indexes:
```sql
CREATE INDEX idx_qr_codes_shop_collected ON qr_codes (is_shop_points_collected) WHERE is_shop_points_collected = false;
CREATE INDEX idx_qr_codes_consumer_collected ON qr_codes (is_consumer_points_collected) WHERE is_consumer_points_collected = false;
```

#### `consumer_qr_scans` table

Add a `claim_lane` column:
```sql
ALTER TABLE consumer_qr_scans ADD COLUMN claim_lane text DEFAULT 'consumer';
-- Allowed: 'shop', 'consumer'
```

**Replace the unique index:**
```sql
DROP INDEX uq_consumer_qr_scans_qr_collected_once;
CREATE UNIQUE INDEX uq_consumer_qr_scans_lane
  ON consumer_qr_scans (qr_code_id, claim_lane)
  WHERE (collected_points = true);
```
This allows one `collected_points = true` row per QR **per lane**.

Backfill existing data:
```sql
UPDATE consumer_qr_scans SET claim_lane = 'consumer' WHERE claim_lane IS NULL;
```

### C.3 Function Changes

#### `consumer_collect_points` → needs `p_claim_lane` parameter

Current logic checks `is_points_collected` (single boolean). Must change to:
```sql
-- Instead of:
IF v_qr.is_points_collected THEN error...
-- Do:
IF p_claim_lane = 'shop' AND v_qr.is_shop_points_collected THEN error...
IF p_claim_lane = 'consumer' AND v_qr.is_consumer_points_collected THEN error...

-- Instead of:
UPDATE qr_codes SET is_points_collected = true
-- Do:
IF p_claim_lane = 'shop' THEN
  UPDATE qr_codes SET is_shop_points_collected = true ...
ELSE
  UPDATE qr_codes SET is_consumer_points_collected = true ...
END IF;

-- Insert with claim_lane
INSERT INTO consumer_qr_scans (..., claim_lane) VALUES (..., p_claim_lane);
```

### C.4 View Changes

All four views reference `collected_points = true` without lane filtering. They will continue to work correctly because they aggregate ALL collected scans. However, for **lane-specific reporting** (e.g., "show only shop-claimed points"), the views would need:

```sql
-- Optional: parameterized or filtered versions
WHERE claim_lane = 'shop'  -- or 'consumer'
```

**Minimum viable:** No view changes needed if we don't need lane-specific reporting immediately. The views will sum both lanes' points together, which is probably the desired behavior for consumer balance.

**For shop-specific reporting:** The `shop_points_ledger` view should add `claim_lane` as a column so downstream filtering is possible.

### C.5 API Route Changes

| Route | Change needed |
|-------|--------------|
| `collect-points/route.ts` | Pass `claim_lane` param to RPC (line ~475) |
| `collect-points-auth/route.ts` | Pass `claim_lane` param to RPC (line ~319) |
| `check-lucky-draw-status/route.ts` | Check both booleans (lines 46, 56, 65) |
| `track-scan/route.ts` | Add `claim_lane` to insert (line 99, 212) |
| `check-collection-status/route.ts` | Return per-lane status |

**How to determine the lane:** The API already knows the caller's role. Shop staff routes use `collect-points-auth` with authenticated session → `claim_lane = 'shop'`. Consumer self-scan uses `collect-points` with phone/OTP → `claim_lane = 'consumer'`.

### C.6 Component Changes

| Component | Change needed |
|-----------|--------------|
| `PremiumLoyaltyTemplate.tsx` | Show per-lane status (lines ~1361, 1400 reference `isPointsCollected`) |
| `ConsumerActivationsView.tsx` | Filter by lane or show lane column (lines 224, 254, 265) |

### C.7 Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Unique index swap fails mid-migration | HIGH | Wrap in transaction, test on staging first |
| `is_points_collected` references break | HIGH | Use generated column for backward compat |
| Double-counting in views | MEDIUM | Generated column ensures views still work |
| Race condition on dual collect | LOW | `FOR UPDATE` lock in RPC is per-QR, still safe |
| Existing data has no lane | LOW | Backfill all as `'consumer'` (matches current behavior) |

---

## D. Change 2 — Point Taxonomy Standardization

### D.1 Problem Statement

The current `transaction_type` column is an ad-hoc string with a CHECK constraint listing 9 values. It mixes concerns:
- **What happened** (scan, migration, game_win)
- **Direction** (earn vs redeem)
- **Source system** (roadtour, registration)

For reporting, the system needs orthogonal dimensions that can be filtered and aggregated independently.

### D.2 Proposed New Columns on `points_transactions`

```sql
ALTER TABLE points_transactions ADD COLUMN point_category text;
ALTER TABLE points_transactions ADD COLUMN point_indicator text;
ALTER TABLE points_transactions ADD COLUMN point_owner_type text;
ALTER TABLE points_transactions ADD COLUMN point_direction text;
```

#### Taxonomy Values

**`point_category`** — the business event:
| Value | Description | Maps from current `transaction_type` |
|-------|-------------|--------------------------------------|
| `scan` | QR code scan collection | `earn` (from collect flow) |
| `roadtour` | RoadTour campaign reward | `roadtour` |
| `survey` | Survey completion reward | `roadtour_survey` |
| `registration` | Registration bonus | `registration` |
| `game` | Game/scratch-card win | `game_win` |
| `referral` | Referral bonus | (new — from referral system) |
| `migration` | Legacy data migration | `MIGRATION` |
| `adjustment` | Manual admin adjustment | `adjust` |
| `redemption` | Spending points on reward | `redeem` |
| `expiry` | Points expiration | `expire` |

**`point_indicator`** — sub-classification:
| Category | Possible indicators |
|----------|-------------------|
| `scan` | `product_qr`, `shop_qr`, `promo_qr` |
| `roadtour` | `booth_scan`, `product_scan` |
| `game` | `scratch_card`, `spin_wheel`, `lucky_draw` |
| `redemption` | `physical_reward`, `voucher`, `point_reward` |
| `migration` | `legacy_system`, `csv_import`, `manual` |

**`point_owner_type`** — who owns the points:
| Value | Description |
|-------|-------------|
| `consumer` | End consumer |
| `shop` | Shop organization |
| `hq` | Headquarters |

**`point_direction`** — earn or spend:
| Value | Description |
|-------|-------------|
| `earn` | Points flow in (positive) |
| `spend` | Points flow out (negative) |

### D.3 Backfill Strategy

```sql
UPDATE points_transactions SET
  point_category = CASE transaction_type
    WHEN 'earn' THEN 'scan'
    WHEN 'redeem' THEN 'redemption'
    WHEN 'expire' THEN 'expiry'
    WHEN 'adjust' THEN 'adjustment'
    WHEN 'game_win' THEN 'game'
    WHEN 'MIGRATION' THEN 'migration'
    WHEN 'registration' THEN 'registration'
    WHEN 'roadtour' THEN 'roadtour'
    WHEN 'roadtour_survey' THEN 'survey'
  END,
  point_direction = CASE
    WHEN transaction_type IN ('redeem', 'expire') THEN 'spend'
    ELSE 'earn'
  END,
  point_owner_type = 'consumer'  -- all current data is consumer-owned
WHERE point_category IS NULL;
```

Only 2,917 rows — instant backfill.

### D.4 Relationship to `consumer_qr_scans`

The `consumer_qr_scans` table has its own `adjustment_type` column (`scan`, `manual_add`, `system_collection`). This is **not** the same as `transaction_type` in `points_transactions`. They serve different purposes:
- `consumer_qr_scans.adjustment_type` = how the scan row was created
- `points_transactions.transaction_type` = what business event the transaction represents

**Recommendation:** Do NOT add taxonomy columns to `consumer_qr_scans`. That table is about scan events, not financial transactions. The taxonomy belongs on `points_transactions` only.

However, for the `shop_points_ledger` view (which UNIONs both tables), the view should map scan events to the taxonomy:
```sql
-- In the consumer_qr_scans half of the UNION:
'scan'::text AS point_category,
'earn'::text AS point_direction,
'consumer'::text AS point_owner_type
```

### D.5 View Changes Required

#### `v_consumer_points_balance`
The `transaction_points` CTE has hardcoded CASE statements like:
```sql
WHEN pt.transaction_type = 'redeem' THEN abs(pt.points_amount)
WHEN pt.transaction_type = 'adjust' THEN pt.points_amount
WHEN pt.transaction_type = 'MIGRATION' THEN pt.points_amount
WHEN pt.transaction_type <> ALL(...) THEN pt.points_amount  -- catch-all
```

Replace with:
```sql
WHEN pt.point_direction = 'spend' THEN abs(pt.points_amount)
-- or use point_category for finer breakdown
```

**Note:** The existing view fields (`total_redeemed`, `total_migration`, `total_other`, `total_adjusted`) can be preserved by referencing `point_category` instead of `transaction_type`. Zero functional change to consumers of the view.

#### `shop_points_ledger`
Add taxonomy columns to both halves of the UNION. The `consumer_qr_scans` half gets hardcoded values, the `points_transactions` half uses the new columns.

#### `v_shop_points_balance`
Currently references `transaction_type` in CASE logic:
```sql
WHEN transaction_type = 'scan' → total_earned_scans
WHEN transaction_type IN ('manual','adjust') → total_manual_adjustments
WHEN transaction_type = 'redeem' → total_redeemed
```
Replace with `point_category` and `point_direction`.

#### `v_shop_points_summary`
Wraps `v_consumer_points_balance` — no direct changes needed if the underlying view is updated.

### D.6 Code Changes Required

**Writes (inserting transactions) — must populate new columns:**

| File | Line(s) | Current `transaction_type` | New taxonomy values |
|------|---------|---------------------------|---------------------|
| `collect-points/route.ts` | ~475-478 | (via RPC `consumer_collect_points`) | N/A — scan goes to `consumer_qr_scans`, not `points_transactions` |
| `collect-points-auth/route.ts` | ~319-322 | (via RPC `consumer_collect_points`) | Same as above |
| `claim-reward/route.ts` (roadtour) | 181 | `'roadtour'` or `'roadtour_survey'` | `point_category='roadtour'/'survey'`, `point_direction='earn'` |
| `redeem-reward/route.ts` | 299 | `'earn'` or `'redeem'` | `point_category='redemption'/'scan'`, `point_direction='spend'/'earn'` |
| `point-migration/route.ts` | 323 | `'MIGRATION'` | `point_category='migration'`, `point_direction='earn'` |
| `point-migration-stream/route.ts` | 594 | `'MIGRATION'` | Same |
| `scratch-card/claim/route.ts` | 162 | `'adjust'` | `point_category='game'`, `point_indicator='scratch_card'`, `point_direction='earn'` |
| `actions.ts` | 746 | `'adjust'` | `point_category='adjustment'`, `point_direction='earn'` |
| `AdminCatalogPage.tsx` | 636 | `'adjust'` | `point_category='adjustment'` |
| `ShopCatalogPage.tsx` | 357 | insert with negative | `point_category='redemption'`, `point_direction='spend'` |

**Reads (filtering/displaying `transaction_type`) — must use new columns for new queries:**

| File | What it filters on | Impact |
|------|--------------------|--------|
| `AdminCatalogPage.tsx` | `.eq("transaction_type", "redeem")` | Filter on `point_category = 'redemption'` |
| `redemptions/route.ts` | `.eq('transaction_type', 'redeem')` | Same |
| `redemption-history/route.ts` | `.eq('transaction_type', 'redeem')` | Same |
| `scanned-products/route.ts` | `.eq('transaction_type', 'scan')` | Filter on `point_category = 'scan'` |
| `ShopCatalogPage.tsx` | Display logic, filter type | Use `point_category` |
| `points-history/route.ts` | Maps `entry.transaction_type` for display | Map `point_category` instead |
| `tools-customer-growth.ts` | AI analytics queries | Use new columns for aggregation |

### D.7 Deprecation Path for `transaction_type`

1. Add four new columns (nullable)
2. Backfill existing rows
3. Update all write paths to populate new columns alongside `transaction_type`
4. Update views to use new columns
5. Update read paths one by one
6. Eventually: drop the CHECK constraint, make `transaction_type` nullable, stop populating it
7. Final: drop `transaction_type` column

**Keep `transaction_type` populated** during the transition period so no existing queries break. The new columns are additive.

### D.8 Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| View recreation fails | MEDIUM | Views are `CREATE OR REPLACE` — safe |
| Missing backfill for some rows | LOW | Only 2,917 rows, verify with count |
| Code still reads `transaction_type` | LOW | Keep populating both during transition |
| TypeScript types out of sync | LOW | Regenerate `database.ts` after migration |
| `record_roadtour_reward` function hard-codes insert | MEDIUM | Update function to populate new columns |

---

## E. RoadTour Implementation Context

### E.1 Current State (pushed to staging as of commit `8beef4a`)

RoadTour reuses the existing consumer QR flow via `PremiumLoyaltyTemplate.tsx` with a `roadtourContext` prop. Key differences from product flow:

| Aspect | Product Flow | RoadTour Flow |
|--------|-------------|---------------|
| Entry point | `/scan?token=...` | Same, with `roadtourContext` |
| Points via | `consumer_collect_points` RPC → `consumer_qr_scans` | `record_roadtour_reward` RPC → `points_transactions` |
| Duplicate guard | `is_points_collected` flag + unique index | `roadtour_scan_events` table (per-campaign) |
| `transaction_type` | N/A (scan goes to `consumer_qr_scans`) | `'roadtour'` or `'roadtour_survey'` |
| Animation | "Genuine Product Verified!" | "Bonus Points Await!" |
| Address field | Shown in profile gate | Hidden |

### E.2 Impact of Dual-Claim on RoadTour

RoadTour does NOT use `consumer_collect_points` or `consumer_qr_scans`. It goes directly to `points_transactions` via `record_roadtour_reward`. Therefore:

**Dual-claim (Change 1) has ZERO impact on RoadTour flow.** RoadTour already has its own duplicate prevention via `roadtour_scan_events` and does not touch the QR collection flags.

### E.3 Impact of Taxonomy on RoadTour

The `record_roadtour_reward` function inserts into `points_transactions` with `p_transaction_type` defaulting to `'roadtour'`. This function must be updated to:
1. Accept and populate `point_category`, `point_direction`, `point_owner_type`
2. Or: derive them from `p_transaction_type` automatically

The `claim-reward/route.ts` passes `p_transaction_type: 'roadtour'` or `'roadtour_survey'` (line 181). This becomes:
```
point_category: 'roadtour' or 'survey'
point_direction: 'earn'
point_owner_type: 'consumer'
```

Minimal change — update the RPC function and the TypeScript caller.

---

## F. Combined Blast Radius

### F.1 Database Objects to Modify

| Object | Type | Change 1 | Change 2 | Notes |
|--------|------|----------|----------|-------|
| `qr_codes` | Table | ✅ Add 2 booleans, generated column | — | 1M+ rows, needs backfill |
| `consumer_qr_scans` | Table | ✅ Add `claim_lane`, replace unique index | — | 43K rows |
| `points_transactions` | Table | — | ✅ Add 4 columns | 2.9K rows |
| `consumer_collect_points` | Function | ✅ Add `p_claim_lane` param | — | Primary collection RPC |
| `record_roadtour_reward` | Function | — | ✅ Add taxonomy params | RoadTour RPC |
| `v_consumer_points_balance` | View | ⚠️ Optional lane filter | ✅ Replace CASE logic | Complex CTE |
| `shop_points_ledger` | View | ⚠️ Add `claim_lane` col | ✅ Add taxonomy cols | UNION view |
| `v_shop_points_balance` | View | — | ✅ Replace CASE logic | Aggregation view |
| `v_shop_points_summary` | View | — | ⚠️ Indirect (via sub-view) | Wrapper view |
| `uq_consumer_qr_scans_qr_collected_once` | Index | ✅ Replace with lane-aware | — | **Critical** |
| `idx_qr_codes_status_flags` | Index | ✅ Rebuild with new columns | — | Composite index |

### F.2 TypeScript Files Impacted

**47 files total** reference points-related entities. Grouped by change:

**Change 1 only (dual-claim) — 11 files:**
- `collect-points/route.ts` — pass `claim_lane` to RPC
- `collect-points-auth/route.ts` — pass `claim_lane` to RPC
- `check-lucky-draw-status/route.ts` — check per-lane flags
- `check-collection-status/route.ts` — return per-lane status
- `track-scan/route.ts` — add `claim_lane` to insert
- `PremiumLoyaltyTemplate.tsx` — show per-lane UI state
- `ConsumerActivationsView.tsx` — filter/display lane
- `qr-resolver.ts` — lane-aware lookups
- `deletionValidation.ts` — delete both lanes on QR deletion
- `ConsumerAnalyticsTab.tsx` — optional lane breakdown
- `ShopPerformanceTab.tsx` — optional lane breakdown

**Change 2 only (taxonomy) — 15 files:**
- `claim-reward/route.ts` (roadtour) — add taxonomy to RPC call
- `redeem-reward/route.ts` — populate taxonomy on insert
- `point-migration/route.ts` — populate taxonomy on insert
- `point-migration-stream/route.ts` — populate taxonomy on insert
- `scratch-card/claim/route.ts` — populate taxonomy on insert
- `actions.ts` — populate taxonomy on adjust
- `AdminCatalogPage.tsx` — use taxonomy for filters/inserts
- `ShopCatalogPage.tsx` — use taxonomy for display/filters
- `redemptions/route.ts` — filter by `point_category`
- `redemption-history/route.ts` — filter by `point_category`
- `scanned-products/route.ts` — filter by `point_category`
- `points-history/route.ts` — map `point_category` for display
- `shop-points-report/route.ts` — use new view columns
- `tools-customer-growth.ts` — use taxonomy for AI analytics
- `database.ts` — regenerate types

**Both changes — 5 files (also listed above):**
- `qr-resolver.ts`
- `AdminCatalogPage.tsx`
- `ShopCatalogPage.tsx`
- `actions.ts`
- `ConsumerActivationsView.tsx`

**Unaffected (read-only or no semantic change needed) — 21 files:**
These files reference `consumer_qr_scans` or `points_transactions` for deletion, export, restore, listing, WA marketing, or agent queries. They don't need changes unless we want taxonomy in export/agent responses.

### F.3 Supabase Migrations Required

All changes should be in a single migration file with two sections:

```
supabase/migrations/YYYYMMDD_dual_claim_and_taxonomy.sql
```

Sections:
1. Add `claim_lane` to `consumer_qr_scans` + backfill + new unique index
2. Add `is_shop_points_collected` / `is_consumer_points_collected` to `qr_codes` + backfill + generated column
3. Add 4 taxonomy columns to `points_transactions` + backfill
4. Update `consumer_collect_points` function
5. Update `record_roadtour_reward` function
6. Recreate all 4 views

---

## G. Migration Strategy

### G.1 Recommended Order

**Phase 1 — Additive schema (zero downtime)**
1. Add `claim_lane` column to `consumer_qr_scans` (DEFAULT 'consumer', nullable at first)
2. Add `is_shop_points_collected`, `is_consumer_points_collected` to `qr_codes` (DEFAULT false)
3. Add 4 taxonomy columns to `points_transactions` (nullable)
4. Backfill all three tables
5. Deploy code that writes BOTH old and new columns

**Phase 2 — Switch constraints**
1. Drop old unique index, create new lane-aware index
2. Make `claim_lane` NOT NULL
3. Create generated column for `is_points_collected`
4. Update functions (`consumer_collect_points`, `record_roadtour_reward`)
5. Recreate views
6. Deploy code that reads new columns

**Phase 3 — Cleanup (can be deferred)**
1. Remove old `is_points_collected` writes from code
2. Drop CHECK constraint on `transaction_type`
3. Eventually drop `transaction_type` column

### G.2 Rollback Plan

- Phase 1 is fully additive — rollback = drop new columns
- Phase 2 index swap is the only destructive step — keep old index definition in migration comments
- Code dual-writes ensure backward compat during Phase 1→2 transition

### G.3 Testing Checkpoints

| Checkpoint | What to verify |
|------------|----------------|
| After Phase 1 | Existing product scan still works (single-collect), all views return same data |
| After Phase 2.1 | New unique index allows lane-based dual insert |
| After Phase 2.4 | RPC accepts `claim_lane` param, defaults to `'consumer'` |
| After Phase 2.5 | `v_consumer_points_balance` returns same totals as before |
| After full deploy | Shop staff can claim → consumer can also claim same QR |

### G.4 Estimated Scope

| Phase | DB changes | Code files | Risk |
|-------|-----------|------------|------|
| Phase 1 | 3 ALTER + 3 UPDATE | 0 (or minimal dual-write) | Low |
| Phase 2 | 1 DROP INDEX + 1 CREATE INDEX + 2 functions + 4 views | ~26 files | Medium |
| Phase 3 | Cleanup | ~10 files | Low |

---

## Appendix: Key SQL Definitions (Reference)

### Unique Index (Current — to be replaced)
```sql
CREATE UNIQUE INDEX uq_consumer_qr_scans_qr_collected_once
  ON consumer_qr_scans (qr_code_id)
  WHERE (collected_points = true);
```

### consumer_collect_points (Current — to be modified)
```sql
-- Locks QR row with FOR UPDATE
-- Checks is_points_collected boolean
-- Sets is_points_collected = true
-- Inserts consumer_qr_scans with collected_points = true, adjustment_type = 'scan'
```

### points_transactions CHECK (Current — to be expanded or removed)
```sql
CHECK (transaction_type = ANY(ARRAY[
  'earn','redeem','expire','adjust','game_win',
  'MIGRATION','registration','roadtour','roadtour_survey'
]))
```

### record_roadtour_reward (Current — to add taxonomy)
```sql
-- Inserts into points_transactions with p_transaction_type (default 'roadtour')
-- Duplicate check via roadtour_scan_events table
-- Does NOT touch qr_codes.is_points_collected
```
