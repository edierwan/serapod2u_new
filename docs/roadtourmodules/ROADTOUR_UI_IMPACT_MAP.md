# RoadTour Event — UI / Server Impact Map

_Last updated: this RoadTour Event redesign cycle._

## New code

| Path | Purpose |
|---|---|
| `app/src/lib/roadtour/events.ts` | Types + helpers (`fetchRoadtourRuns`, `fetchActiveOrDraftRoadtourRuns`, `createRoadtourRun`, duplicate-policy labels). |
| `app/src/modules/roadtour/components/CreateRoadtourEventDialog.tsx` | Modal for creating a RoadTour Event. Fields: name, description, start/end date, status (draft/active), duplicate policy (default `per_run`). |
| `docs/roadtourmodules/sql/staging_cleanup_roadtour_transactions.sql` | Transaction-only cleanup (preserves master data). Already executed on staging. |
| `docs/roadtourmodules/sql/staging_enhance_roadtour_event_schema.sql` | Adds `roadtour_runs` + `roadtour_run_id` FK columns + snapshot trigger + RLS + partial unique index. Already executed on staging. |
| `docs/roadtourmodules/sql/production_cleanup_roadtour_transactions.sql` | Production mirror — **NOT executed**. Manual run only. |
| `docs/roadtourmodules/sql/production_enhance_roadtour_event_schema.sql` | Production mirror — **NOT executed**. Manual run only. |

## Modified UI

| File | Change |
|---|---|
| `app/src/modules/roadtour/components/RoadtourCampaignsView.tsx` | Adds Event selector card at top, Event column in table, modal "Section 0 — RoadTour Event" with select + create button + info banner, summary card showing duplicate protection. `Create Campaign` is disabled when no event exists. |
| `app/src/modules/roadtour/components/RoadtourQrManagementView.tsx` | New `RoadTour Event` filter dropdown placed before Campaign filter. Campaign dropdown narrows to selected event. |
| `app/src/modules/roadtour/components/RoadtourVisitsView.tsx` | New `Event` filter that scopes `roadtour_official_visits.roadtour_run_id`. |
| `app/src/modules/roadtour/components/RoadtourAnalyticsView.tsx` | New `RoadTour Event` filter in the date-range toolbar; metrics scope to campaigns within the selected event. |
| `app/src/modules/roadtour/components/RoadtourSettingsView.tsx` | Added an informational card explaining that duplicate-protection now lives on the RoadTour Event. |

## Modified server logic

| File | Change |
|---|---|
| `app/src/app/api/roadtour/claim-reward/route.ts` | Resolves the campaign's `roadtour_run_id` + run's `duplicate_policy`. Adds new `per_run`, `per_campaign`, `per_day`, `none` policies to `hasExistingRoadtourReward`. When `per_run` triggers, returns 409 with message _"This shop has already participated in this RoadTour Event (Name)."_ Existing legacy policies (`one_per_user_per_day`, `one_per_shop_per_am_per_day`, `one_per_user_per_campaign`) remain supported. |

## Database additions (staging only)

- `public.roadtour_runs` — parent table with status (`draft|active|completed|cancelled`) and duplicate_policy (`per_run|per_campaign|per_day|none`).
- `roadtour_run_id` columns added (FK) to: `roadtour_campaigns`, `roadtour_qr_codes`, `roadtour_scan_events`, `roadtour_official_visits`, `roadtour_survey_responses`, `roadtour_claim_notification_logs`, `roadtour_qr_delivery_logs`.
- BEFORE INSERT trigger `snapshot_roadtour_run_id()` auto-fills `roadtour_run_id` from the campaign when omitted.
- Partial unique index `uq_roadtour_official_visit_per_run_shop (roadtour_run_id, shop_id) WHERE visit_status='official'`.
- RLS policies (`roadtour_runs_admin_select`, `roadtour_runs_admin_manage`) for admin role codes.
