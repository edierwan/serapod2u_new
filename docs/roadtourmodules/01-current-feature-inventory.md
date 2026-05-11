# 01. Current Feature Inventory

This inventory is based on the current codebase plus the refreshed production schema snapshot in `supabase/schemas/current_schema.sql`.

Status labels used here:
- Working
- Partial
- UI-only
- Broken
- Unknown / needs testing

## Feature inventory

| Feature | Route / path | Page or component files | API routes used | DB tables / functions / views used | Current status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Customer & Growth entry for RoadTour | `/customer-growth`, top nav Marketing > Road Tour, dashboard view id `roadtour` | `app/src/app/customer-growth/page.tsx`, `app/src/app/customer-growth/_lib.ts`, `app/src/modules/customer-growth/customerGrowthNav.ts`, `app/src/components/dashboard/DashboardContent.tsx`, `app/src/modules/roadtour/roadtourNav.ts` | none | `users`, `organizations`, `roles` | Working | Navigation is wired correctly, but customer-growth access is effectively open to all authenticated users at the page-context layer. |
| RoadTour landing page | `/roadtour`, dashboard view id `roadtour` | `app/src/app/roadtour/page.tsx`, `app/src/app/roadtour/_lib.ts`, `app/src/modules/roadtour/components/RoadtourLandingView.tsx`, `app/src/modules/roadtour/components/RoadtourTopNav.tsx`, `app/src/components/dashboard/DashboardContent.tsx` | none | `users`, `organizations`, `roles` | Working | Landing cards and top nav are present and connected. This is a shell page, not a data-heavy screen. |
| RoadTour campaigns | Dashboard view id `roadtour-campaigns` within `/roadtour` | `app/src/modules/roadtour/components/RoadtourCampaignsView.tsx`, `app/src/modules/roadtour/roadtourNav.ts`, `app/src/components/dashboard/DashboardContent.tsx` | none. Uses direct client-side Supabase writes | `roadtour_campaigns`, `roadtour_campaign_managers`, `roadtour_qr_codes`, `roadtour_settings`, `organizations`, `users`, `states` | Partial | Campaign CRUD works through client-side Supabase access. Missing campaign target list, missing survey-template selection on the campaign form, and reference lookup code does not explicitly filter by org. |
| QR management | Dashboard view id `roadtour-qr` within `/roadtour` | `app/src/modules/roadtour/components/RoadtourQrManagementView.tsx` | `POST /api/roadtour/send-qr-whatsapp`, `GET /api/roadtour/qr-image/[token]` | `roadtour_qr_codes`, `roadtour_campaigns`, `roadtour_qr_delivery_logs`, `users`, `slugify_roadtour_segment()`, `sync_roadtour_qr_route_fields()` | Partial | Preview, copy, download, send, and revoke are wired. Delivery log insertion happens from the client after send. No QR batch management, print tracking, resend workflow, or revoke reason audit. |
| Visits | Dashboard view id `roadtour-visits` within `/roadtour` | `app/src/modules/roadtour/components/RoadtourVisitsView.tsx` | none. Uses direct client-side Supabase reads | `roadtour_official_visits`, `roadtour_scan_events`, `roadtour_claim_notification_logs`, `roadtour_campaigns`, `users`, `organizations` | Partial | The screen reads official visits and related scan data, but the data model has no explicit check-in, check-out, route planning, or visit outcome structure. Needs live testing for drill-down correctness. |
| Survey builder | Dashboard view id `roadtour-surveys` within `/roadtour` | `app/src/modules/roadtour/components/RoadtourSurveyBuilderView.tsx` | none. Uses direct client-side Supabase writes | `roadtour_survey_templates`, `roadtour_survey_template_fields` | Partial | Builder UI is substantial and includes field previews and linked shop fields. Production schema has no `version` column even though the UI displays one. No publish workflow or assignment workflow from this screen. |
| Survey claim flow | Public scan routes: `/scan?rt=...`, `/roadtour/[year]/[campaignSlug]/[referenceSlug]`, `/rt/[year]/[campaignSlug]/[referenceSlug]` | `app/src/app/scan/page.tsx`, `app/src/app/roadtour/[year]/[campaignSlug]/[referenceSlug]/page.tsx`, `app/src/app/rt/[year]/[campaignSlug]/[referenceSlug]/page.tsx`, `app/src/lib/roadtour/server.ts`, `app/src/app/api/roadtour/claim-reward/route.ts`, `app/src/components/journey/templates/PremiumLoyaltyTemplate.tsx`, `app/src/modules/roadtour/components/RoadtourJourneyWrapper.tsx` | `POST /api/roadtour/claim-reward` | `validate_roadtour_qr_token()`, `record_roadtour_reward()`, `roadtour_scan_events`, `roadtour_survey_responses`, `roadtour_survey_response_items`, `roadtour_official_visits`, `points_transactions`, `v_consumer_points_balance` | Broken | The live claim route inserts only `scan_event_id` and `template_id` into `roadtour_survey_responses`, but production schema requires more non-null columns. It also inserts survey response items using a `value` field that does not exist in the production table. |
| Public QR validation and friendly URLs | `/scan?rt=...`, `/roadtour/...`, `/rt/...` | `app/src/app/scan/page.tsx`, `app/src/app/roadtour/[year]/[campaignSlug]/[referenceSlug]/page.tsx`, `app/src/app/rt/[year]/[campaignSlug]/[referenceSlug]/page.tsx`, `app/src/lib/roadtour/server.ts`, `app/src/app/api/roadtour/qr-image/[token]/route.ts` | `GET /api/roadtour/qr-image/[token]` | `roadtour_qr_codes`, `validate_roadtour_qr_token()`, `slugify_roadtour_segment()`, `sync_roadtour_qr_route_fields()` | Working | Friendly path resolution is present and canonical path fields exist in production schema. Validation increments `usage_count` on every call, so QR analytics are inflated by page loads. |
| Analytics | Dashboard view id `roadtour-analytics` within `/roadtour` | `app/src/modules/roadtour/components/RoadtourAnalyticsView.tsx` | none. Uses direct client-side Supabase reads | `roadtour_campaigns`, `roadtour_campaign_managers`, `roadtour_qr_codes`, `roadtour_official_visits`, `roadtour_scan_events`, `roadtour_survey_responses` | Broken | `totalScans` uses the length of a limited 100-row query instead of an exact count. `topCampaigns.scan_count` is derived from visit rows, not scan rows, so the metric is not trustworthy. |
| WhatsApp monitoring | Dashboard view id `roadtour-whatsapp` within `/roadtour` | `app/src/modules/roadtour/components/RoadtourWhatsAppMonitoringView.tsx` | none. Uses direct client-side Supabase reads | `roadtour_qr_delivery_logs`, `roadtour_campaigns`, `users` | Partial | This page monitors QR delivery logs only. It does not include `roadtour_claim_notification_logs`, so claim alert delivery is invisible here. No resend, reconciliation, or export actions were found. |
| RoadTour settings | Dashboard view id `roadtour-settings` within `/roadtour` | `app/src/modules/roadtour/components/RoadtourSettingsView.tsx` | `POST /api/roadtour/test-claim-alert` | `roadtour_settings`, `roadtour_survey_templates`, `organizations`, `roadtour_claim_notification_logs` via helper writes | Partial | Settings screen is feature-rich, but it writes org-level reward and survey defaults that do not drive the live claim flow directly. Claim flow uses campaign-level `default_points`, `reward_mode`, and `survey_template_id`. |
| Point Catalog > RoadTour Reward Settings | Point Catalog management tabs | `app/src/components/engagement/catalog/PointsConfigurationSettings.tsx`, `app/src/components/engagement/catalog/RoadtourRewardSettings.tsx` | none. Uses direct client-side Supabase writes | `roadtour_settings`, `roadtour_survey_templates`, `organizations` | Partial | This is a second admin surface for the same `roadtour_settings` row. It overlaps with `RoadtourSettingsView`, which is likely to confuse operators and cause inconsistent expectations. |
| Claim alert notifications | no dedicated admin page; configured via RoadTour Settings | `app/src/lib/roadtour/notifications.ts`, `app/src/app/api/roadtour/test-claim-alert/route.ts`, `app/src/app/api/settings/whatsapp/_utils.ts` | `POST /api/roadtour/test-claim-alert` | `roadtour_settings`, `roadtour_claim_notification_logs`, `users`, `notification_provider_configs` | Partial | Claim alerts support manual recipients or HQ-org recipients and normalize numbers before logging. No dedicated monitoring UI for these alert logs was found. |
| Public QR image endpoint | `GET /api/roadtour/qr-image/[token]` | `app/src/app/api/roadtour/qr-image/[token]/route.ts` | `GET /api/roadtour/qr-image/[token]` | `roadtour_qr_codes`, `buildRoadTourUrl()` | Partial | Public by design and token-gated. No rate limiting or signed URL pattern was found. |
| QR send endpoint | `POST /api/roadtour/send-qr-whatsapp` | `app/src/app/api/roadtour/send-qr-whatsapp/route.ts`, `app/src/app/api/settings/whatsapp/_utils.ts` | `POST /api/roadtour/send-qr-whatsapp` | `notification_provider_configs`, `users`, `roadtour_qr_codes` indirectly, external WhatsApp gateway | Partial | Admin check exists in the route, but no request-schema validation or rate limiting was found. The database log write is done later from the client, not in the route itself. |
| Role-based access handling | `/roadtour`, all RoadTour dashboard views, admin-only roadtour APIs | `app/src/app/roadtour/_lib.ts`, `app/src/app/customer-growth/_lib.ts`, `app/src/app/api/settings/whatsapp/_utils.ts`, `app/src/hooks/usePermissions.ts`, production RLS in `supabase/schemas/current_schema.sql` | `POST /api/roadtour/send-qr-whatsapp`, `POST /api/roadtour/test-claim-alert` | RLS policies on all main RoadTour tables except claim-notification logs | Partial | Page-shell access is auth-only, not RoadTour-role-aware. Client-side writes rely on RLS. Production RLS checks hardcoded admin-style role codes but does not constrain by org. |
| Legacy standalone scan component | no live route reference found | `app/src/modules/roadtour/components/RoadtourScanPage.tsx` | would call `POST /api/roadtour/claim-reward` if used | `validate_roadtour_qr_token()`, `roadtour_scan_events`, `roadtour_survey_responses` | UI-only | No live references were found to this component. It appears to be older or dead code compared with the current `RoadtourJourneyWrapper` plus `PremiumLoyaltyTemplate` flow. |

## Additional notes

### Navigation and menu wiring

Relevant files:
- `app/src/modules/customer-growth/customerGrowthNav.ts`
- `app/src/modules/roadtour/roadtourNav.ts`
- `app/src/modules/roadtour/components/RoadtourTopNav.tsx`
- `app/src/components/dashboard/DashboardContent.tsx`

Observed behavior:
- RoadTour is placed under Marketing inside Customer & Growth.
- Internal RoadTour navigation is card-based on the landing page and dropdown-based in the top nav.
- The dashboard wiring is complete for landing, campaigns, QR, surveys, visits, analytics, WhatsApp monitoring, and settings.

### Role-handling summary

Observed role handling surfaces:
- `app/src/app/roadtour/_lib.ts`: requires authenticated user and organization, but not a specific RoadTour permission.
- `app/src/app/api/settings/whatsapp/_utils.ts`: `isAdminUser()` treats role level `<= 20` or role codes `super_admin`, `admin`, `org_admin` as admin.
- Production RLS: RoadTour tables are mostly restricted to role codes `SA`, `HQ`, `POWER_USER`, `HQ_ADMIN`, `SUPER_ADMIN`, and `ADMIN`.

Implication:
- UI reachability and DB reachability are not aligned cleanly.
- A non-admin authenticated user can still land on the RoadTour shell, but data reads or writes then depend on DB policy outcomes.
- The app-level permission vocabulary and the RLS role-code vocabulary are not one consistent model.

## Inventory conclusion

RoadTour is not a placeholder module. It has real screens, real schema, public scan routing, friendly URLs, QR sending, claim alerts, and analytics pages.

The main problem is that some of the most business-critical features are only partial:
- campaign configuration is incomplete,
- survey submission looks broken against production schema,
- settings are duplicated and misleading,
- analytics are not yet reliable,
- and access control depends too heavily on RLS while page routing remains broadly accessible.