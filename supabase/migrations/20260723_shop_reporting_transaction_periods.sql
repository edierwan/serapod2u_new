-- Transaction-derived reporting months for Executive Dashboard shop reports.
-- SECURITY INVOKER is intentional: consumer_qr_scans RLS remains authoritative.
-- The existing schema only has the QR/lane uniqueness index. This partial
-- timestamp index supports both distinct-period discovery and bounded month reads.
CREATE INDEX IF NOT EXISTS consumer_qr_scans_shop_reporting_scanned_at_idx
  ON public.consumer_qr_scans (scanned_at DESC)
  WHERE COALESCE(is_manual_adjustment, false) = false
    AND shop_id IS NOT NULL
    AND scanned_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reporting_shop_scan_periods()
RETURNS TABLE(period_key text, transaction_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    to_char(date_trunc('month', cqs.scanned_at AT TIME ZONE 'Asia/Kuala_Lumpur'), 'YYYY-MM') AS period_key,
    count(*)::bigint AS transaction_count
  FROM public.consumer_qr_scans cqs
  WHERE COALESCE(cqs.is_manual_adjustment, false) = false
    AND cqs.shop_id IS NOT NULL
    AND cqs.scanned_at IS NOT NULL
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

REVOKE ALL ON FUNCTION public.reporting_shop_scan_periods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reporting_shop_scan_periods() TO authenticated;

COMMENT ON FUNCTION public.reporting_shop_scan_periods() IS
  'Accessible valid shop scan months in Asia/Kuala_Lumpur; honors consumer_qr_scans RLS.';
