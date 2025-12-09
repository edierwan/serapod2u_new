-- Fix: Update current_location_org_id for QR codes with warehouse statuses
-- This corrects QR codes that have warehouse statuses (received_warehouse, warehouse_packed)
-- but have incorrect current_location_org_id values

-- Step 1: Identify the correct warehouse org ID from qr_master_codes
-- Step 2: Update qr_codes.current_location_org_id to match their master code's warehouse

UPDATE qr_codes qc
SET current_location_org_id = qmc.warehouse_org_id,
    updated_at = now()
FROM qr_master_codes qmc
WHERE qc.master_code_id = qmc.id
  AND qc.status IN ('received_warehouse', 'warehouse_packed', 'packed')
  AND (qc.current_location_org_id IS NULL 
       OR qc.current_location_org_id != qmc.warehouse_org_id);

-- Verify the fix
SELECT 
    COUNT(*) as total_fixed,
    qc.status,
    qc.current_location_org_id
FROM qr_codes qc
JOIN qr_master_codes qmc ON qc.master_code_id = qmc.id
WHERE qc.status IN ('received_warehouse', 'warehouse_packed', 'packed')
GROUP BY qc.status, qc.current_location_org_id;
