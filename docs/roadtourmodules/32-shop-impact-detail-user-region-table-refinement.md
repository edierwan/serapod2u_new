# RoadTour Shop Impact Detail User And Region Table Refinement

## Current Issue

- Shop Impact Detail used a single-line shop label that mixed shop name and branch/location.
- The visible table still showed an `AM` column, which reduced the space available for participant context.
- Region was text-only even though RoadTour already has state flag rendering elsewhere.
- The table did not show which participant most recently scanned after the visit window for the impacted shop row.

## UI Changes Made

- Updated the visible table order to:
  - Shop
  - Participant
  - Region
  - Campaign
  - Visit Date
  - Before window count
  - After window count
  - Lift %
  - Last Scan After
  - Status
- Removed the visible `AM` column from Shop Impact Detail only.
- Kept KPI cards, charts, selected snapshot, pagination, filters, and impact calculations intact.

## Shop Column Formatting

- The table now shows the shop name on the first line.
- Branch/location is shown on a second line in smaller muted text when available.
- Structured fields are preferred:
  - `organizations.org_name`
  - `organizations.branch`
- Safe fallback parsing is only used when there is a trailing parenthetical suffix and it matches known location context such as the shop city or state.
- Ambiguous names such as brand names with parentheses are left untouched when no location hint matches.

## Region Flag Implementation

- Reused the existing `RoadtourStateFlag` component already used by other RoadTour pages.
- Region cells now prefer the state flag image/icon.
- If a matching flag asset is unavailable, the component falls back to text badge output instead of a broken image.

## Participant Data Source

- No schema or SQL changes were made.
- Participant data comes from the same `consumer_qr_scans` window already used for before/after impact counting.
- The implementation reads:
  - `consumer_qr_scans.consumer_id`
  - `consumer_qr_scans.consumer_name`
  - `consumer_qr_scans.consumer_phone`
- When `consumer_id` is available, it resolves the latest participant name and phone from `users`.
- If user lookup is unavailable, it falls back to the scan snapshot name/phone stored on `consumer_qr_scans`.
- If multiple distinct participants scanned in the after-window, the table shows `N participants` and, when available, the latest participant phone on the second line.
- If no reliable participant linkage exists, the cell shows `-`.

## Selected Shop Snapshot

- The snapshot now mirrors the refined shop display.
- It also shows the resolved participant summary when available.

## Export Behavior

- The current Shop Impact Detail view does not have its own export action, so no export code path was changed for this task.
- If export is added later for this view, it should use the existing full shop label and text region name, plus the resolved participant summary.

## No SQL Or Migration Changes

- Confirmed: no SQL, no migrations, and no database schema changes were made.

## Files Updated

- `app/src/modules/roadtour/components/analytics/ShopImpactDetailView.tsx`
- `app/src/modules/roadtour/components/analytics/ShopImpactDetailView.test.tsx`
- `app/src/modules/roadtour/lib/analytics/postVisitImpact.ts`
- `app/src/modules/roadtour/lib/analytics/shopImpactDetail.ts`
- `app/src/modules/roadtour/types/analytics.ts`

## Staging Checklist

- Open RoadTour > Analytics > Shop Impact Detail.
- Confirm shop labels render as two lines when branch/location is available.
- Confirm the visible `AM` column is gone.
- Confirm Region shows flag icons where supported and text fallback where not.
- Confirm the Participant column appears after Shop.
- Confirm rows with a latest after-window participant show name and phone.
- Confirm rows without reliable participant data show `-`.
- Compare at least one impacted row against Recent Scans or raw scan history for participant accuracy.
- Confirm filters still work: campaign, account manager, region, impact status, shop search, date range, and 3D/7D/30D windows.
- Confirm KPI cards, charts, pagination, and Selected Shop Snapshot still behave correctly.