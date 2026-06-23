# RoadTour Visit Tracking User Column And Date Time Format

## Scope

- Update RoadTour Analytics > Visit Tracking so the Date / Time cell uses two lines in the same column.
- Add a User column after Shop.
- Show participant name and phone when available.
- Keep filters, charts, export, pagination, and detail view working without schema changes.

## Data Source

- Reused the existing `roadtour_official_visits.official_scan_event_id` foreign key.
- Loaded participant data from the linked `roadtour_scan_events` row.
- Preferred `roadtour_scan_events.scanned_by_user_id -> users.full_name / users.phone`.
- Fell back to `roadtour_scan_events.consumer_phone` when no linked user profile name is available.
- Show `-` when neither a linked user nor a fallback phone exists.

## UI Changes

- Visit table Date / Time now renders date on the first line and time on the second line.
- Added the new User column immediately after Shop.
- Detail view now includes the same participant summary.
- Scan detail rows also show participant phone when the scan user name is missing or incomplete.

## Export

- Updated CSV export to include separate `Date` and `Time` columns.
- Added the new `User` column to export using `Name (Phone)` when both values exist.

## Files Updated

- `app/src/modules/roadtour/components/RoadtourVisitsView.tsx`
- `app/src/modules/roadtour/lib/visit-tracking.ts`
- `app/src/modules/roadtour/lib/visit-tracking.test.ts`

## Validation Notes

- No SQL, migrations, or schema changes were made.
- Static editor validation passed on the touched files.
- Focused Vitest execution was not available in this temp worktree because `vitest/config` is missing from the installed dependencies there.