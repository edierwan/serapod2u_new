-- ============================================================================
-- 2026-04-09: RoadTour fixes
-- 1. Grant authenticated role access to all roadtour tables
-- 2. Grant anon role SELECT access for public scan page
-- ============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'roadtour_settings',
    'roadtour_campaigns',
    'roadtour_campaign_managers',
    'roadtour_qr_codes',
    'roadtour_qr_delivery_logs',
    'roadtour_scan_events',
    'roadtour_official_visits',
    'roadtour_survey_templates',
    'roadtour_survey_template_fields',
    'roadtour_survey_responses',
    'roadtour_survey_response_items'
  ])
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon', t);
  END LOOP;
END;
$$;
