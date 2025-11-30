-- Migration: 060_update_get_consumer_scan_stats.sql
-- Description: Update get_consumer_scan_stats to include scratch card plays

CREATE OR REPLACE FUNCTION public.get_consumer_scan_stats(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_qr_codes INTEGER;
  v_unique_consumer_scans INTEGER;
  v_lucky_draw_entries INTEGER;
  v_redemptions INTEGER;
  v_points_collected_count INTEGER;
  v_scratch_card_plays INTEGER;
BEGIN
  -- 1. Total QR Codes for this order
  SELECT COUNT(*) INTO v_total_qr_codes
  FROM qr_codes
  WHERE order_id = p_order_id;

  -- 2. Unique Consumer Scans (QR codes that have been scanned at least once)
  SELECT COUNT(*) INTO v_unique_consumer_scans
  FROM qr_codes
  WHERE order_id = p_order_id
    AND (total_consumer_scans > 0 OR first_consumer_scan_at IS NOT NULL);

  -- 3. Lucky Draw Entries
  SELECT COUNT(*) INTO v_lucky_draw_entries
  FROM qr_codes
  WHERE order_id = p_order_id
    AND is_lucky_draw_entered = TRUE;

  -- 4. Redemptions (Gifts Claimed)
  SELECT COUNT(*) INTO v_redemptions
  FROM qr_codes
  WHERE order_id = p_order_id
    AND is_redeemed = TRUE;

  -- 5. Points Collected Count
  SELECT COUNT(*) INTO v_points_collected_count
  FROM qr_codes
  WHERE order_id = p_order_id
    AND is_points_collected = TRUE;

  -- 6. Scratch Card Plays
  -- Count unique QR codes from this order that have been used in scratch card plays
  SELECT COUNT(DISTINCT scp.qr_code_id) INTO v_scratch_card_plays
  FROM scratch_card_plays scp
  JOIN qr_codes qc ON scp.qr_code_id = qc.id
  WHERE qc.order_id = p_order_id;

  RETURN jsonb_build_object(
    'total_qr_codes', v_total_qr_codes,
    'unique_consumer_scans', v_unique_consumer_scans,
    'lucky_draw_entries', v_lucky_draw_entries,
    'redemptions', v_redemptions,
    'points_collected_count', v_points_collected_count,
    'scratch_card_plays', v_scratch_card_plays
  );
END;
$$;
