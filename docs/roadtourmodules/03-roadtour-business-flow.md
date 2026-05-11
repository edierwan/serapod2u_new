# 03. RoadTour Business Flow

This flow map separates three things:
- intended RoadTour business lifecycle,
- what exists in the current code and production schema,
- what is still missing before real operations begin.

## Executive view

The current implementation supports a meaningful RoadTour backbone:
- campaign rows exist,
- account managers can be assigned,
- QR tokens can be generated,
- public scan routes exist,
- rewards can be credited,
- official visits can be recorded,
- analytics and monitoring pages exist.

The biggest gap is that the current system does not yet model the full operational chain cleanly. It jumps from campaign setup to QR distribution to consumer claim, but it does not model planned target shops, explicit field check-in/check-out, or reliable end-to-end survey capture with production-schema alignment.

## Full lifecycle map

| Step | Exists in current code? | Supporting files / routes / tables | What is missing | Production risk |
| --- | --- | --- | --- | --- |
| 1. HQ/Admin creates RoadTour campaign | Yes, partial | UI: `app/src/modules/roadtour/components/RoadtourCampaignsView.tsx`<br>Page shell: `app/src/app/roadtour/page.tsx`<br>Tables: `roadtour_campaigns`, `roadtour_settings` | No approval workflow, no publish workflow, no campaign template flow, no automatic inheritance from `roadtour_settings` defaults | Admin can create campaigns, but campaign setup is incomplete and easy to misconfigure |
| 2. Target shops/customers are selected | Partial only | Table: `roadtour_campaigns.region_scope`<br>UI: region chips in `RoadtourCampaignsView.tsx`<br>Supporting reads: `organizations`, `states` | No explicit target list table for shops or customers, no target-count denominator, no target import | Coverage reporting and visit planning will be weak from day one |
| 3. Account managers / field staff are assigned | Yes, partial | UI: `RoadtourCampaignsView.tsx` manager dialog<br>Tables: `roadtour_campaign_managers`, `users` | The code loads eligible references with `can_be_reference = true`, but no explicit org filter is enforced in the component. No route planning or territory model exists. | Wrong users may be assignable; assignment history is weak |
| 4. QR codes are generated | Yes | UI logic: `syncCampaignQrs()` inside `RoadtourCampaignsView.tsx`<br>Table: `roadtour_qr_codes`<br>Trigger/function: `trg_roadtour_qr_route_fields`, `sync_roadtour_qr_route_fields()`, `slugify_roadtour_segment()` | No QR batch entity, no generation audit columns, no revoke reason, no print/export tracking | Hard to govern QR issuance at production scale |
| 5. WhatsApp or campaign message is sent | Partial | API: `POST /api/roadtour/send-qr-whatsapp`<br>Helper: `app/src/app/api/settings/whatsapp/_utils.ts`<br>UI: `RoadtourQrManagementView.tsx`<br>Tables: `roadtour_qr_delivery_logs`, `notification_provider_configs` | No campaign broadcast model, no send queue, no retry workflow, no integrated claim-alert monitoring screen | Delivery can happen, but audit and operational visibility are thin |
| 6. Field staff visits shop | Partial | Tables: `roadtour_official_visits`, `roadtour_scan_events`<br>UI: `RoadtourVisitsView.tsx` | No explicit check-in/check-out workflow, no route planning, no visit-outcome taxonomy, no staff-side dedicated visit app | “Official visit” is currently closer to a reward side effect than a full field-ops object |
| 7. Staff records visit outcome / survey | Partial to broken | UI builder: `RoadtourSurveyBuilderView.tsx`<br>Claim API: `POST /api/roadtour/claim-reward`<br>Tables: `roadtour_survey_templates`, `roadtour_survey_template_fields`, `roadtour_survey_responses`, `roadtour_survey_response_items` | Campaign form does not set `survey_template_id`. Claim route inserts survey rows with a payload that does not match the production table definition. | Survey-submit campaigns are high risk and likely broken in production |
| 8. QR is scanned / validated | Yes | Routes: `/scan?rt=...`, `/roadtour/[year]/...`, `/rt/[year]/...`<br>Helpers: `app/src/lib/roadtour/server.ts`<br>Function: `validate_roadtour_qr_token()`<br>Table: `roadtour_qr_codes` | No rate limiting, no abuse throttling, `usage_count` increments on every validation call, not only on success | Analytics inflation and public endpoint abuse risk |
| 9. Reward is credited | Yes, partial | API: `POST /api/roadtour/claim-reward`<br>Function: `record_roadtour_reward()`<br>Tables: `roadtour_scan_events`, `roadtour_official_visits`, `points_transactions`, `roadtour_claim_notification_logs` | Duplicate handling is not fully atomic, survey path is mismatched, public endpoint uses service-role logic and accepts optional email/password in request body | Reward credit can work, but hardening is incomplete |
| 10. Analytics / reporting updates | Partial | UI: `RoadtourAnalyticsView.tsx`, `RoadtourWhatsAppMonitoringView.tsx`, `RoadtourVisitsView.tsx`<br>Tables: `roadtour_campaigns`, `roadtour_campaign_managers`, `roadtour_qr_codes`, `roadtour_scan_events`, `roadtour_official_visits`, `roadtour_survey_responses`, `roadtour_qr_delivery_logs`, `roadtour_claim_notification_logs` | No target-list denominator, no export layer, no reporting views, inaccurate KPI calculations in current UI | Decision-making based on current analytics would be risky |
| 11. Campaign closes / completes | Partial | Table: `roadtour_campaigns.status`<br>UI actions: `RoadtourCampaignsView.tsx` | No structured closeout, no completion summary, no archive reason, no retention/archival workflow | Weak end-of-campaign governance |

## Detailed flow narrative

## 1. Campaign setup

Observed implementation:
- Admin users can open the RoadTour shell and reach the Campaigns screen.
- Campaign rows are created directly from the client by `RoadtourCampaignsView.tsx`.
- Core fields recorded are name, description, start date, end date, default points, reward mode, QR mode, region scope, and notes.

What is missing:
- No survey template chooser in the campaign form, despite `roadtour_campaigns.survey_template_id` existing in production schema.
- No explicit target shop list.
- No approval/publish stage.
- No campaign owner, reviewer, or closeout actor model.

Result:
- Campaign rows can be created, but the business configuration surface is incomplete.

## 2. Assignment model

Observed implementation:
- References or account managers are loaded from `users` where `can_be_reference = true`.
- Campaign assignments are stored in `roadtour_campaign_managers`.
- QR creation is triggered when a campaign is activated or when managers are assigned to an already-active campaign.

What is missing:
- No dedicated field-staff role model inside RoadTour.
- No org-safe assignment guarantee in component code.
- No route-planning or visit quota model.

Result:
- Assignment exists technically, but operational staffing is underspecified.

## 3. QR generation and routing

Observed implementation:
- QR tokens are stored in `roadtour_qr_codes`.
- Friendly route fields are populated by `sync_roadtour_qr_route_fields()`.
- Canonical URLs can be built as `/roadtour/<year>/<campaign-slug>/<reference-slug>-<short-code>`.
- QR image generation is done through `GET /api/roadtour/qr-image/[token]`.

What is missing:
- Batch identity for grouped QR issuance.
- Printable/exportable governance metadata.
- Revoke reason and revoke actor tracking.

Result:
- The QR layer is functional for MVP routing but not yet enterprise-ready for audit and reporting.

## 4. Public claim journey

Observed implementation:
- Public routes resolve RoadTour context and then render the RoadTour claim journey through `PremiumLoyaltyTemplate` using `RoadtourJourneyWrapper`.
- `validate_roadtour_qr_token()` checks QR status, campaign status, and date range.
- `claim-reward` handles profile gating, shop gating, survey gating, scan-event creation, reward credit, and claim-alert notifications.

What is missing or weak:
- No request-schema validation.
- No rate limiting.
- Optional email/password login inside request body is a security-sensitive pattern.
- Scan validation increments `usage_count` before reward completion.

Result:
- Consumer-facing flow exists, but hardening is incomplete.

## 5. Survey branch

Observed implementation:
- Production schema supports templates, fields, responses, and response items.
- Builder UI exists and is more complete than placeholder level.

Current implementation mismatch:
- Campaign UI does not set `survey_template_id`.
- Claim API inserts survey responses using a payload that is missing required production columns.
- Claim API inserts response items using a non-existent `value` column rather than the production fields `answer_text`, `answer_json`, or `answer_number`.

Result:
- Survey as a configured business feature exists.
- Survey as a reliable production execution path is not yet ready.

## 6. Official visit creation

Observed implementation:
- `record_roadtour_reward()` inserts into `roadtour_official_visits` after successful reward processing.
- Unique constraint enforces one official visit per campaign/account-manager/shop/date.

What is missing:
- No explicit field-staff check-in/check-out event model.
- No visit-outcome taxonomy.
- No duration metrics.

Result:
- Official visit is derived from reward flow, not captured as a first-class field-ops workflow.

## 7. Monitoring and analytics

Observed implementation:
- Admin screens exist for visits, analytics, WhatsApp monitoring, and settings.
- The base tables needed for reporting are present.

What is missing or wrong:
- Analytics calculations are not always exact.
- WhatsApp monitoring excludes claim-alert logs.
- No export/report pack was found.
- No reporting views or materialized summaries were found.

Result:
- The module is monitorable, but not yet reporting-grade.

## Business-flow conclusion

RoadTour already has enough moving parts to count as a real workflow, but not enough operational structure to count as a reliable production field-operations system.

The current implementation is strongest in:
- QR token structure,
- public route resolution,
- base event tables,
- and admin CRUD shells.

It is weakest in:
- survey execution integrity,
- tenant-safe access control,
- operational staffing and target modeling,
- and trustworthy reporting.

If the team wants to run the first real RoadTour campaign safely, the highest-priority flow fixes should be:
1. align survey persistence with the production schema,
2. enforce tenant/org isolation in RoadTour RLS and server checks,
3. make one settings source of truth actually drive campaign behavior,
4. add explicit target-shop modeling,
5. harden QR scan abuse and analytics accuracy.