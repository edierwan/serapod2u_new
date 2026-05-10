# RoadTour Analytics Recent Scans Fix

Date: 2026-05-10

## Scope

This change fixes false `Unknown shop` output in RoadTour Analytics Recent Scans, adds server-side pagination for scan volume growth, and adds estimated reward cost to the Points Awarded KPI card.

Changed file:

- `app/src/modules/roadtour/components/RoadtourAnalyticsView.tsx`

Read-only references used during implementation:

- `app/src/lib/engagement/point-claim-settings.ts`
- `app/src/utils/phone.ts`
- `supabase/schemas/current_schema.sql`

## Root Cause

The Recent Scans list was too dependent on direct scan fields:

- shop resolution relied mainly on `roadtour_scan_events.shop_id`
- consumer context relied mainly on `scanned_by_user_id`

That was not enough for real RoadTour data, where valid shop context may instead be recoverable from survey rows, QR ownership, user organization linkage, or reference linkage.

## Recent Scans Resolution Logic

### Consumer resolution

Consumer context now resolves in this order:

1. normalize `consumer_phone` and match a user by phone
2. fallback to `scanned_by_user_id`

Displayed consumer values then use the resolved user when available, otherwise the stored phone value.

### Shop resolution

Shop context now resolves in this order:

1. `roadtour_scan_events.shop_id`
2. `roadtour_survey_responses.shop_id` via `scan_event_id`
3. `roadtour_qr_codes.shop_id`
4. resolved consumer user `organization_id`
5. reference user `organization_id` via normalized `referral_phone`
6. consumer user `shop_name`

If none of those paths resolve, the UI keeps `Unknown shop` and shows `No linked shop context` as the note.

If resolution falls back to `user.shop_name`, the row shows `Linked via user profile` as the note.

## Pagination

Recent Scans now uses server-side pagination on `roadtour_scan_events`:

- query includes `{ count: 'exact' }`
- rows are fetched with `.range(...)`
- default page size is `10`
- selectable page sizes are `10`, `20`, and `50`

This avoids loading the full scan history just to render the latest rows.

## Estimated Reward Cost

The Points Awarded KPI card now also shows estimated reward cost.

Formula source:

- helper: `normalizePointClaimSettings(rawSettings, fallbackShopPoints)`
- config field: `organizations.settings.point_value_rm`
- display formula: `totalPointsAwarded * pointValueRM`

If `point_value_rm` is not configured as a positive number, the card shows `Not configured`.

## DB Change Status

- DB schema change: No
- Migration required: No

## Remaining Schema Gaps

This fix uses all currently available RoadTour context without schema changes. Remaining unresolved cases are rows where none of these sources exist:

- direct `shop_id`
- linked survey `shop_id`
- linked QR `shop_id`
- consumer organization
- reference organization
- user profile `shop_name`

Those rows still need source-data enrichment upstream if they must always resolve to a shop.

## Validation

Focused validation:

- `get_errors` on `RoadtourAnalyticsView.tsx`: no errors

Broader validation:

- `npm run build` in `app/`: success
- direct TypeScript app-wide compile: fails on many pre-existing files outside RoadTour
- no typecheck failures were reported for `RoadtourAnalyticsView.tsx`
- no lint configuration or lint script exists in `app/`