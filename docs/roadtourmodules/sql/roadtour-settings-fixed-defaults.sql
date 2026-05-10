-- =============================================================================
-- RoadTour Settings — Fixed Defaults (Phase 1 Production Rollout)
-- =============================================================================
-- Created: 2026-05-10
-- Author : Platform / RoadTour Simplification
--
-- Purpose:
--   Lock the operational rules the RoadTour Settings UI no longer exposes,
--   and align future inserted rows + already-existing rows with the agreed
--   first-rollout defaults.
--
-- Locked defaults (must match app/src/modules/roadtour/components/RoadtourSettingsView.tsx
-- ROADTOUR_LOCKED_DEFAULTS):
--   qr_mode                = 'persistent'
--   duplicate_rule_reward  = 'one_per_user_per_campaign'
--   official_visit_rule    = 'one_per_shop_per_am_per_day'
--   require_login          = TRUE
--   require_shop_context   = TRUE
--   require_geolocation    = TRUE
--   whatsapp_send_enabled  = TRUE
--
-- Safety:
--   * Idempotent. Safe to re-run.
--   * Scoped strictly to public.roadtour_settings.
--   * Does NOT drop/rename columns and does NOT loosen any CHECK constraint.
--   * Does NOT touch users, organizations, shops, products, orders, loyalty,
--     or supply chain modules.
--   * Does NOT modify roadtour_campaigns, roadtour_qr_codes, roadtour_scan_events,
--     roadtour_official_visits or any other RoadTour table.
--
-- Run target:
--   Apply on staging first. Production rollout requires explicit instruction
--   per the RoadTour simplification plan.
-- =============================================================================

BEGIN;

-- 1) Realign DB-level defaults so future INSERTs match the locked policy.
ALTER TABLE public.roadtour_settings
    ALTER COLUMN qr_mode               SET DEFAULT 'persistent',
    ALTER COLUMN duplicate_rule_reward SET DEFAULT 'one_per_user_per_campaign',
    ALTER COLUMN official_visit_rule   SET DEFAULT 'one_per_shop_per_am_per_day',
    ALTER COLUMN require_login         SET DEFAULT TRUE,
    ALTER COLUMN require_shop_context  SET DEFAULT TRUE,
    ALTER COLUMN require_geolocation   SET DEFAULT TRUE,
    ALTER COLUMN whatsapp_send_enabled SET DEFAULT TRUE;

-- 2) Backfill existing rows so current orgs follow the locked rules.
--    Only updates rows where the field actually differs to keep updated_at
--    churn minimal, and only touches the seven locked columns.
UPDATE public.roadtour_settings
   SET qr_mode               = 'persistent',
       duplicate_rule_reward = 'one_per_user_per_campaign',
       official_visit_rule   = 'one_per_shop_per_am_per_day',
       require_login         = TRUE,
       require_shop_context  = TRUE,
       require_geolocation   = TRUE,
       whatsapp_send_enabled = TRUE,
       updated_at            = NOW()
 WHERE qr_mode               IS DISTINCT FROM 'persistent'
    OR duplicate_rule_reward IS DISTINCT FROM 'one_per_user_per_campaign'
    OR official_visit_rule   IS DISTINCT FROM 'one_per_shop_per_am_per_day'
    OR require_login         IS DISTINCT FROM TRUE
    OR require_shop_context  IS DISTINCT FROM TRUE
    OR require_geolocation   IS DISTINCT FROM TRUE
    OR whatsapp_send_enabled IS DISTINCT FROM TRUE;

COMMIT;

-- Verification (read-only):
--   SELECT org_id, qr_mode, duplicate_rule_reward, official_visit_rule,
--          require_login, require_shop_context, require_geolocation,
--          whatsapp_send_enabled
--     FROM public.roadtour_settings;
