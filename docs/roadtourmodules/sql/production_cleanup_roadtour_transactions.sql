-- ============================================================================
-- PRODUCTION: RoadTour transaction cleanup
-- ⚠ MANUAL RUN ONLY. NOT EXECUTED BY CODER AI.
-- ⚠ Review production data before running. Production may contain real
--   campaign rows that should not be deleted without owner approval.
-- ============================================================================
-- This is the same body as the staging script. Owner must:
--   1. Confirm there is no live RoadTour activity in flight.
--   2. Run during a maintenance window.
--   3. Inspect BEFORE counts before COMMIT.
--   4. Replace `COMMIT;` with `ROLLBACK;` if anything looks wrong.
-- ============================================================================

\echo '=== PRODUCTION RoadTour cleanup. Review BEFORE counts ==='
SELECT 'roadtour_claim_notification_logs' AS table_name, count(*) FROM public.roadtour_claim_notification_logs
UNION ALL SELECT 'roadtour_survey_response_items',   count(*) FROM public.roadtour_survey_response_items
UNION ALL SELECT 'roadtour_survey_responses',        count(*) FROM public.roadtour_survey_responses
UNION ALL SELECT 'roadtour_official_visits',         count(*) FROM public.roadtour_official_visits
UNION ALL SELECT 'roadtour_qr_delivery_logs',        count(*) FROM public.roadtour_qr_delivery_logs
UNION ALL SELECT 'roadtour_scan_events',             count(*) FROM public.roadtour_scan_events
UNION ALL SELECT 'roadtour_qr_codes',                count(*) FROM public.roadtour_qr_codes
UNION ALL SELECT 'roadtour_campaign_managers',       count(*) FROM public.roadtour_campaign_managers
UNION ALL SELECT 'roadtour_campaigns',               count(*) FROM public.roadtour_campaigns
UNION ALL SELECT 'points_transactions_roadtour',     count(*) FROM public.points_transactions WHERE transaction_type ILIKE 'roadtour%'
ORDER BY 1;

-- ============================================================================
-- ⚠ STOP. Confirm the counts above are expected before continuing.
-- ============================================================================

BEGIN;

DELETE FROM public.roadtour_claim_notification_logs;
DELETE FROM public.roadtour_survey_response_items;
DELETE FROM public.roadtour_survey_responses;
DELETE FROM public.roadtour_official_visits;
DELETE FROM public.roadtour_qr_delivery_logs;
DELETE FROM public.roadtour_scan_events;
DELETE FROM public.roadtour_qr_codes;
DELETE FROM public.roadtour_campaign_managers;
DELETE FROM public.roadtour_campaigns;

DELETE FROM public.points_transactions
WHERE transaction_type ILIKE 'roadtour%';

-- Master data is intentionally NOT touched:
--   roadtour_settings, roadtour_survey_templates, roadtour_survey_template_fields,
--   users, organizations, profiles.

-- Replace with ROLLBACK; if anything is unexpected.
COMMIT;

\echo '=== AFTER counts ==='
SELECT 'roadtour_claim_notification_logs' AS table_name, count(*) FROM public.roadtour_claim_notification_logs
UNION ALL SELECT 'roadtour_survey_response_items',   count(*) FROM public.roadtour_survey_response_items
UNION ALL SELECT 'roadtour_survey_responses',        count(*) FROM public.roadtour_survey_responses
UNION ALL SELECT 'roadtour_official_visits',         count(*) FROM public.roadtour_official_visits
UNION ALL SELECT 'roadtour_qr_delivery_logs',        count(*) FROM public.roadtour_qr_delivery_logs
UNION ALL SELECT 'roadtour_scan_events',             count(*) FROM public.roadtour_scan_events
UNION ALL SELECT 'roadtour_qr_codes',                count(*) FROM public.roadtour_qr_codes
UNION ALL SELECT 'roadtour_campaign_managers',       count(*) FROM public.roadtour_campaign_managers
UNION ALL SELECT 'roadtour_campaigns',               count(*) FROM public.roadtour_campaigns
UNION ALL SELECT 'points_transactions_roadtour',     count(*) FROM public.points_transactions WHERE transaction_type ILIKE 'roadtour%'
ORDER BY 1;
