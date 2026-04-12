-- ============================================================================
-- Migration: Add consumer_phone column to roadtour_scan_events
-- Date: 2026-04-12
-- Purpose: Track the phone number of the consumer who scanned the QR code
-- ============================================================================

ALTER TABLE public.roadtour_scan_events
  ADD COLUMN IF NOT EXISTS consumer_phone text;

COMMENT ON COLUMN public.roadtour_scan_events.consumer_phone IS
  'Phone number of the consumer who scanned the QR code';
