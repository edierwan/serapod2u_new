# RoadTour Event — Staging Test Report (agent-side)

## Verified by automation
- `app/src/lib/roadtour/events.ts` — types and helpers compile cleanly (no TS errors in file).
- `app/src/modules/roadtour/components/CreateRoadtourEventDialog.tsx` — compiles cleanly.
- `app/src/modules/roadtour/components/RoadtourCampaignsView.tsx` — compiles. Pre-existing schema-drift errors (`is_active` on empty type, `call_name`) are unrelated to this redesign.
- `app/src/modules/roadtour/components/RoadtourQrManagementView.tsx` — compiles cleanly.
- `app/src/modules/roadtour/components/RoadtourVisitsView.tsx` — compiles cleanly.
- `app/src/modules/roadtour/components/RoadtourAnalyticsView.tsx` — compiles cleanly.
- `app/src/modules/roadtour/components/RoadtourSettingsView.tsx` — compiles cleanly.
- `app/src/app/api/roadtour/claim-reward/route.ts` — compiles cleanly.

## Database (staging)
- `public.roadtour_runs` exists with RLS enabled.
- `roadtour_run_id` column present on 7 transactional roadtour tables.
- 11 new indexes including the partial unique index `uq_roadtour_official_visit_per_run_shop`.
- Snapshot trigger `snapshot_roadtour_run_id()` installed and active.
- Transactional rows post-cleanup: **0**.
- Preserved master data: 1702 users, 773 organizations, 1 settings row, 2 survey templates, 7 fields.

## Manual scenarios
Pending — see `ROADTOUR_STAGING_TEST_PLAN.md` (A through H). Manual tester to fill out below.

| Scenario | Status | Notes |
|---|---|---|
| A — Empty state | ☐ | |
| B — Campaign tied to event | ☐ | |
| C — Per-run duplicate protection | ☐ | |
| D — QR Management filter | ☐ | |
| E — Visits filter | ☐ | |
| F — Analytics filter | ☐ | |
| G — Settings note | ☐ | |
| H — Draft event | ☐ | |

## Production
- `docs/roadtourmodules/sql/production_cleanup_roadtour_transactions.sql` — NOT executed.
- `docs/roadtourmodules/sql/production_enhance_roadtour_event_schema.sql` — NOT executed.
- Production rollout to occur only after staging sign-off.
