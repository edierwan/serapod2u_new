-- ============================================================================
-- STAGING: RoadTour transaction cleanup
-- Run against: supabase database on serapod-stg-db (staging only)
-- DO NOT RUN ON PRODUCTION.
-- Author: Coder AI, 2026-05-12
-- ----------------------------------------------------------------------------
-- Resets RoadTour transactional rows so the new roadtour_runs schema can be
-- introduced with NOT NULL roadtour_run_id on roadtour_campaigns.
--
-- MASTER DATA PRESERVED:
--   - roadtour_settings
--   - roadtour_survey_templates
--   - roadtour_survey_template_fields
--   - users, organizations, profiles, auth.*
--
-- Wrapped in BEGIN/COMMIT. If any DELETE returns unexpected counts the operator
-- may ROLLBACK manually.
-- ============================================================================

\echo '=== BEFORE counts ==='
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
UNION ALL SELECT 'roadtour_settings (PRESERVED)',    count(*) FROM public.roadtour_settings
UNION ALL SELECT 'roadtour_survey_templates (PRESERVED)',         count(*) FROM public.roadtour_survey_templates
UNION ALL SELECT 'roadtour_survey_template_fields (PRESERVED)',   count(*) FROM public.roadtour_survey_template_fields
UNION ALL SELECT 'organizations (PRESERVED)',                     count(*) FROM public.organizations
UNION ALL SELECT 'users (PRESERVED)',                             count(*) FROM public.users
ORDER BY 1;

BEGIN;

-- 1. notification logs (FK -> scan_events, campaigns, qr_codes)
DELETE FROM public.roadtour_claim_notification_logs;

-- 2. survey response items (CASCADE from responses but explicit to be safe)
DELETE FROM public.roadtour_survey_response_items;

-- 3. survey responses
DELETE FROM public.roadtour_survey_responses;

-- 4. official visits
DELETE FROM public.roadtour_official_visits;

-- 5. qr delivery logs
DELETE FROM public.roadtour_qr_delivery_logs;

-- 6. scan events (must come after delivery_logs / claim_notification_logs FK)
DELETE FROM public.roadtour_scan_events;

-- 7. qr codes
DELETE FROM public.roadtour_qr_codes;

-- 8. campaign manager assignments
DELETE FROM public.roadtour_campaign_managers;

-- 9. campaigns (parent of qr_codes / scan_events / etc.)
DELETE FROM public.roadtour_campaigns;

-- 10. points_transactions originated from RoadTour
DELETE FROM public.points_transactions
WHERE transaction_type ILIKE 'roadtour%';

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
UNION ALL SELECT 'roadtour_settings (PRESERVED)',    count(*) FROM public.roadtour_settings
UNION ALL SELECT 'roadtour_survey_templates (PRESERVED)',         count(*) FROM public.roadtour_survey_templates
UNION ALL SELECT 'roadtour_survey_template_fields (PRESERVED)',   count(*) FROM public.roadtour_survey_template_fields
UNION ALL SELECT 'organizations (PRESERVED)',                     count(*) FROM public.organizations
UNION ALL SELECT 'users (PRESERVED)',                             count(*) FROM public.users
ORDER BY 1;
