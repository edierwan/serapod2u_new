-- STAGING HELPER TEMPLATE
-- Purpose: restore historical SHOP staff attribution on consumer_qr_scans
-- after lane cleanup, using a row-id -> consumer_id CSV exported from production.
--
-- Usage pattern:
-- 1. Export CSV from production with columns: id, consumer_id
-- 2. Feed the CSV into the \copy block below
-- 3. Run only on staging

BEGIN;

CREATE TEMP TABLE restore_shop_staff_map (
  id uuid,
  consumer_id uuid
);

-- In psql, replace the section below with stdin CSV data.
-- \copy restore_shop_staff_map FROM STDIN WITH CSV
-- <id,consumer_id>
-- <id,consumer_id>
-- \.

UPDATE public.consumer_qr_scans cqs
SET consumer_id = m.consumer_id
FROM restore_shop_staff_map m
WHERE cqs.id = m.id
  AND cqs.claim_lane = 'shop'
  AND cqs.collected_points = true;

COMMIT;