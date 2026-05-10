# Survey Templates & Reporting UI

> Status: Implemented (staging) – no DB schema changes.

## Files changed

- `app/src/components/dashboard/DashboardContent.tsx` — switched the
  `roadtour-surveys` view to render the new hub.
- `app/src/modules/roadtour/components/RoadtourSurveyHubView.tsx` — **new.**
  Tab container (Templates / Responses / Reporting).
- `app/src/modules/roadtour/components/RoadtourSurveyResponsesView.tsx` — **new.**
  Survey response records table with filters, pagination, CSV export.
- `app/src/modules/roadtour/components/RoadtourSurveyReportingView.tsx` — **new.**
  Dynamic reporting dashboard (KPIs, dynamic question insights, field explorer,
  records preview, response details, CSV export).
- `app/src/modules/roadtour/components/roadtour-survey-shared.tsx` — **new.**
  Shared `ResponseRow` types, `ResponseDetailsDialog`, masking helpers.
- `app/src/modules/roadtour/components/RoadtourVisitsView.tsx` — default date
  range broadened from last 10 days to last 30 days so newly created visits are
  visible without manually adjusting filters.

## Routes / pages affected

- Customer & Growth → Marketing → RoadTour → Field Operations → **Surveys**
  (`viewId = roadtour-surveys`) — now renders the new
  `RoadtourSurveyHubView` instead of `RoadtourSurveyBuilderView`.
- Existing `RoadtourSurveyBuilderView` is still used as the **Templates** tab,
  so the create / edit / add / reorder / delete flows are preserved.
- No public route changes. `/roadtour/...` and `/scan?rt=...` are untouched.

## Data sources

All read-only — uses existing tables and existing RLS:

- `roadtour_survey_templates` (id, org_id, name, is_active, …)
- `roadtour_survey_template_fields` (id, template_id, field_key, field_label,
  field_type, field_options, is_required, sort_order)
- `roadtour_survey_responses` (id, campaign_id, template_id, response_status,
  submitted_at, points_awarded, shop_id, scanned_by_user_id,
  account_manager_user_id, scan_event_id, …)
- `roadtour_survey_response_items` (response_id, field_key,
  field_label_snapshot, field_type_snapshot, answer_text, answer_json,
  answer_number, media_url)
- `roadtour_campaigns` (id, name, status, org_id) — campaign filter & tenant
  scoping via `roadtour_campaigns!inner(org_id)`.
- `users` (full_name, phone) — joined via `account_manager_user_id`.
- `organizations` + `states` — joined via `shop_id` to surface shop name and
  region.

No new tables, columns, indexes, RLS policies, RPCs or views were created or
modified. **No SQL migration is required.**

## Tabs

| Tab        | Behaviour |
| ---------- | --------- |
| Templates  | Existing `RoadtourSurveyBuilderView` (template list + detail editor + phone preview + linked shop fields). |
| Responses  | All survey responses across templates with filters (template, campaign, status, date range, search) and a dedicated response details dialog. CSV export of the filtered list. |
| Reporting  | Template-driven dashboard with KPIs, dynamic question insights, field explorer, and a 10-row response preview. CSV export includes all answers expanded as columns. |

## How dynamic question analytics work

`RoadtourSurveyReportingView` loads
`roadtour_survey_template_fields` for the selected template, then loads matching
`roadtour_survey_responses` and their items inside the active filter window.
For each field, the items with matching `field_key` are bucketed and a chart /
summary is rendered based on `field_type`:

| Field type        | Visualisation |
| ----------------- | ------------- |
| `yes_no`          | Donut + Yes / No / Unanswered breakdown with percentages. |
| `single_select`, `radio` | Horizontal bar chart by option, sorted by count. |
| `multi_select`, `checkbox` | Horizontal bar chart by option (totals can exceed responses). |
| `number`          | Average / Min / Max stats cards. |
| `text`, `textarea` | Completeness bar + 3 most recent sample answers. |
| `phone`, `email`  | Completeness bar + masking notice. Values masked in details (`maskPhone`). |
| `photo`           | Completeness bar + uploaded notice. |
| Unknown / fallback | Generic "Response coverage" bar. Will not crash. |

KPI cards:

- **Total Responses** – count of responses in the active filter window.
- **Completion Rate** – % of responses with completion_pct ≥ 100.
- **Unique Shops** – count of distinct `shop_id` in the filtered responses.
- **Active Campaigns** – count of distinct `campaign_id` in the filtered responses.
- **Avg. Completion Time** – shows **Not tracked** because the schema does not
  capture survey start/submit timestamps separately.

## Empty states

- **No templates:** "No survey templates yet — Create a survey template to start
  collecting RoadTour responses." (button jumps to Templates tab when shown
  inside Reporting.)
- **No responses (Responses tab):** "No survey responses found — Responses will
  appear here after QR scans and survey submissions."
- **No reporting data (Reporting tab):** "No reporting data for this template —
  Try another campaign, date range, or wait for responses."
- **Template with no fields:** "This template has no fields yet — Add fields in
  the Templates tab to generate insights."

## Permissions

All queries inherit the existing org-scoped RLS on `roadtour_*` tables (see
`supabase/migrations/20260510_roadtour_hardening_and_org_rls.sql` —
`is_roadtour_org_admin`). No additional policies are introduced.

## Known limitations

- Avg. Completion Time is shown as "Not tracked" because the schema does not
  separately persist survey-start timestamps. Adding a column or a derived
  view would be required to populate it.
- Reporting / Responses tabs cap at 1,000 / 500 rows respectively per filter
  query for client-side aggregation. For large datasets a server-side
  aggregator should be added later.
- Region filter values are inferred from `organizations.states.state_name`
  for shops that appear in the current response set; shops without a linked
  state are grouped under "—".

## Testing

| Check | Result |
| ----- | ------ |
| `tsc --noEmit` for new files | clean (no errors in the four new files / one modified file). |
| Templates tab still works | yes — embeds the original `RoadtourSurveyBuilderView`. |
| Phone preview works | yes — unchanged. |
| Reporting tab loads with template selected | yes. |
| Template selector dynamically updates KPIs/insights | yes. |
| Empty states appear when no data | yes. |
| View Details drawer renders dynamic answers | yes. |
| Page does not crash on unknown field types | yes — generic completeness fallback. |
| No unrelated modules touched | confirmed (only `DashboardContent.tsx` import + case + new files + Visit Tracking default-range tweak). |

## SQL scripts to run

**None.** The implementation does not require any DB migration or data change.
