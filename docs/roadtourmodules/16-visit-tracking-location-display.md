# RoadTour Visit Tracking Location Display

Date: 2026-05-10

## Scope

This change updates the RoadTour Visit Tracking table so the main Location column shows a readable label instead of raw latitude and longitude.

Changed file:

- `app/src/modules/roadtour/components/RoadtourVisitsView.tsx`

Read-only references used during implementation:

- `app/src/lib/roadtour/location-shared.ts`
- `app/src/app/api/roadtour/claim-reward/route.ts`
- `supabase/schemas/current_schema.sql`

## Root Cause

The Visit Tracking table was rendering `official_scan.geolocation.lat/lng` directly in the main table, even though the current RoadTour scan model already stores readable location fields and shop address context.

## Data Sources Used

The updated visit query keeps the existing RoadTour visit source and expands the joined fields already present in the schema.

From `roadtour_official_visits` -> `official_scan_event_id` -> `roadtour_scan_events`:

- `geo_label`
- `geo_city`
- `geo_state`
- `geo_full_address`
- `latitude`
- `longitude`
- `accuracy_m`
- `location_status`
- `location_error`
- `location_captured_at`

From `roadtour_official_visits` -> `shop_id` -> `organizations`:

- `org_name`
- `branch`
- `address`
- `address_line2`
- `city`
- state name via `state_id`

## Display Logic

The main table now uses a deterministic fallback chain:

1. Use `geo_label` only when `location_status = 'resolved'`.
2. Else use a shop summary built from `city/state`, `address`, and `address_line2`.
3. Else use reverse-geocoded scan text from `geo_city/geo_state` or `geo_full_address`.
4. Else show `Location captured` when coordinates exist but no readable text is available.
5. Else show `Location unavailable`.

Additional UI rules:

- Accuracy badge mapping:
  - `<= 30m` -> `High accuracy`
  - `31m-100m` -> `Medium accuracy`
  - `> 100m` -> `Low accuracy`
  - missing accuracy -> `Not captured`
- Non-success location states still surface as secondary text through the existing shared status label helper.
- Raw coordinates remain available only in the visit detail dialog.
- CSV export now uses the same human-readable location summary instead of raw coordinates.

## DB Change Status

- DB schema change: No
- Migration required: No

## Future Schema Note

No schema work is required for this fix. If product later wants a permanently curated display label, the clean extension would be a server-side denormalized display field derived at scan time, not a client-side coordinate fallback.

## Validation

Focused validation:

- `get_errors` on `RoadtourVisitsView.tsx`: no errors

Broader validation:

- `npm run build` in `app/`: success
- direct TypeScript app-wide compile: fails on many pre-existing files outside RoadTour
- no typecheck failures were reported for `RoadtourVisitsView.tsx`
- no lint configuration or lint script exists in `app/`