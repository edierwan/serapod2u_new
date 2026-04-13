-- RoadTour location reliability and internal geolocation telemetry

ALTER TABLE public.roadtour_scan_events
  ADD COLUMN IF NOT EXISTS geo_label text,
  ADD COLUMN IF NOT EXISTS geo_city text,
  ADD COLUMN IF NOT EXISTS geo_state text,
  ADD COLUMN IF NOT EXISTS geo_country text,
  ADD COLUMN IF NOT EXISTS geo_full_address text,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS accuracy_m double precision,
  ADD COLUMN IF NOT EXISTS geo_source text,
  ADD COLUMN IF NOT EXISTS geo_payload jsonb,
  ADD COLUMN IF NOT EXISTS location_status text NOT NULL DEFAULT 'missing',
  ADD COLUMN IF NOT EXISTS location_error text,
  ADD COLUMN IF NOT EXISTS location_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS geo_resolved_at timestamptz;

COMMENT ON COLUMN public.roadtour_scan_events.geo_label IS 'Primary readable GeoLoc label shown in visit tracking and WhatsApp alerts.';
COMMENT ON COLUMN public.roadtour_scan_events.geo_city IS 'Reverse-geocoded city or locality for RoadTour scans.';
COMMENT ON COLUMN public.roadtour_scan_events.geo_state IS 'Reverse-geocoded state or region for RoadTour scans.';
COMMENT ON COLUMN public.roadtour_scan_events.geo_country IS 'Reverse-geocoded country for RoadTour scans.';
COMMENT ON COLUMN public.roadtour_scan_events.geo_full_address IS 'Best-effort reverse-geocoded full address for internal RoadTour scan reference.';
COMMENT ON COLUMN public.roadtour_scan_events.latitude IS 'Raw latitude captured for internal RoadTour diagnostics.';
COMMENT ON COLUMN public.roadtour_scan_events.longitude IS 'Raw longitude captured for internal RoadTour diagnostics.';
COMMENT ON COLUMN public.roadtour_scan_events.accuracy_m IS 'Reported browser/device accuracy in meters for the RoadTour scan location.';
COMMENT ON COLUMN public.roadtour_scan_events.geo_source IS 'Source of the RoadTour geolocation payload, typically browser.';
COMMENT ON COLUMN public.roadtour_scan_events.geo_payload IS 'Raw geolocation payload including capture status/error metadata for RoadTour scans.';
COMMENT ON COLUMN public.roadtour_scan_events.location_status IS 'RoadTour location lifecycle: resolved, captured, permission_denied, timeout, unavailable, error, or missing.';
COMMENT ON COLUMN public.roadtour_scan_events.location_error IS 'Last browser or reverse-geocode error recorded for the RoadTour scan location.';
COMMENT ON COLUMN public.roadtour_scan_events.location_captured_at IS 'Timestamp when the browser geolocation capture completed or failed.';
COMMENT ON COLUMN public.roadtour_scan_events.geo_resolved_at IS 'Timestamp when a readable GeoLoc label was successfully resolved.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'roadtour_scan_events_location_status_check'
      AND conrelid = 'public.roadtour_scan_events'::regclass
  ) THEN
    ALTER TABLE public.roadtour_scan_events
      ADD CONSTRAINT roadtour_scan_events_location_status_check
      CHECK (location_status IN ('resolved', 'captured', 'permission_denied', 'timeout', 'unavailable', 'error', 'missing'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_roadtour_scan_events_location_status
  ON public.roadtour_scan_events (location_status, scan_time DESC);

UPDATE public.roadtour_scan_events
SET geo_label = CASE
      WHEN geolocation IS NULL THEN 'Location unavailable'
      ELSE 'Location captured'
    END
WHERE geo_label IS NULL;

UPDATE public.roadtour_scan_events
SET latitude = COALESCE(latitude, NULLIF(geolocation ->> 'lat', '')::double precision),
    longitude = COALESCE(longitude, NULLIF(geolocation ->> 'lng', '')::double precision),
    accuracy_m = COALESCE(accuracy_m, NULLIF(geolocation ->> 'accuracy', '')::double precision),
    geo_source = COALESCE(geo_source, geo_payload ->> 'source', geolocation ->> 'source', CASE WHEN geolocation IS NOT NULL THEN 'browser' ELSE NULL END),
    geo_payload = COALESCE(geo_payload, geolocation),
    location_error = COALESCE(location_error, geo_payload ->> 'error', geolocation ->> 'error'),
    location_captured_at = COALESCE(location_captured_at, NULLIF(geo_payload ->> 'captured_at', '')::timestamptz, NULLIF(geo_payload ->> 'attempted_at', '')::timestamptz, NULLIF(geolocation ->> 'captured_at', '')::timestamptz, NULLIF(geolocation ->> 'attempted_at', '')::timestamptz),
    geo_resolved_at = COALESCE(geo_resolved_at, CASE WHEN COALESCE(NULLIF(trim(geo_label), ''), '') <> '' AND geo_label NOT IN ('Location captured', 'Location unavailable', 'Permission denied') THEN scan_time ELSE NULL END),
    location_status = CASE
      WHEN COALESCE(NULLIF(trim(geo_label), ''), '') <> ''
        AND geo_label NOT IN ('Location captured', 'Location unavailable', 'Permission denied') THEN 'resolved'
      WHEN COALESCE(geo_payload ->> 'status', geolocation ->> 'status', '') IN ('resolved', 'captured', 'permission_denied', 'timeout', 'unavailable', 'error', 'missing')
        THEN COALESCE(geo_payload ->> 'status', geolocation ->> 'status')
      WHEN geolocation IS NOT NULL AND NULLIF(geolocation ->> 'lat', '') IS NOT NULL AND NULLIF(geolocation ->> 'lng', '') IS NOT NULL THEN 'captured'
      ELSE 'missing'
    END;