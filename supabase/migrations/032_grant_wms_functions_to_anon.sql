-- Migration: Grant WMS functions to anon role so server-side routes using the anon key can call them

GRANT EXECUTE ON FUNCTION public.wms_deduct_and_summarize(
  uuid,
  uuid,
  uuid,
  integer,
  uuid,
  timestamp with time zone
) TO anon;

GRANT EXECUTE ON FUNCTION public.wms_from_unique_codes(
  uuid[],
  uuid,
  uuid,
  uuid,
  timestamp with time zone
) TO anon;

GRANT EXECUTE ON FUNCTION public.wms_record_movement_from_summary(jsonb) TO anon;

GRANT EXECUTE ON FUNCTION public.wms_record_movements_from_items(jsonb) TO anon;

GRANT EXECUTE ON FUNCTION public.wms_ship_unique_auto(
  uuid[],
  uuid,
  uuid,
  uuid,
  timestamp with time zone
) TO anon;
