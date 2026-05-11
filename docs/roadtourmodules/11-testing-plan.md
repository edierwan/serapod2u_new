# 11. Testing Plan

This testing plan is designed for prelaunch validation of the current RoadTour module.

It includes:
- manual flow tests
- role and RLS tests
- DB verification checks
- QR and reward-flow checks
- analytics reconciliation checks
- regression checks for production drift

## Test principles

- Treat production schema as the source of truth for expected DB shapes.
- Verify not only UI success messages, but also inserted and updated DB records.
- Validate cross-role and cross-org access explicitly.
- Reconcile analytics with SQL counts before trusting the dashboard.

## Environment recommendations

Use a non-production environment with:
- at least two organizations
- at least one super admin / HQ admin user
- at least one power user
- at least one account manager or reference user
- at least one shop-linked consumer user
- at least one survey template with multiple field types
- at least one WhatsApp provider configuration available for test send

## A. Security and RLS tests

| Test ID | Scenario | Preconditions | Steps | Expected result | Verify in DB / system | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| RT-SEC-01 | Non-admin authenticated user opens `/roadtour` | User has org but no RoadTour admin role | Open `/roadtour` and try campaigns/settings actions | Shell may load, but RoadTour admin data actions should not succeed | Confirm denied data access or empty restricted reads; no write committed | P0 |
| RT-SEC-02 | Admin from org A attempts to read org B RoadTour campaigns through direct client query | Two orgs with RoadTour data | Use browser client/session from org A admin and attempt direct Supabase query for org B campaign id | Query should be denied or return no rows | Confirm DB policy blocks cross-org read | P0 |
| RT-SEC-03 | Admin from org A attempts to update org B campaign | Same as above | Attempt direct update through browser client | Update should fail | Confirm no row mutated | P0 |
| RT-SEC-04 | Public user can only read active public survey template fields | Have active and inactive templates | Trigger public claim context for both | Only active template/fields should be accessible for public rendering | Confirm inactive template not returned | P1 |
| RT-SEC-05 | Claim-notification logs are protected as intended | Need clear expected policy first | Attempt direct browser read from non-privileged session | Result should match intended design | Confirm whether current production behavior is acceptable or a gap | P0 |

## B. Campaign configuration tests

| Test ID | Scenario | Preconditions | Steps | Expected result | Verify in DB / system | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| RT-CAM-01 | Create draft direct-scan campaign | Admin user, valid org | Create campaign with direct scan mode | Draft campaign saves successfully | Row created in `roadtour_campaigns` with correct org, status, reward fields | P0 |
| RT-CAM-02 | Activate campaign with assigned reference | Existing draft campaign and eligible reference | Assign reference, activate campaign | Campaign becomes active and QR row is generated | `roadtour_campaign_managers` active row exists; `roadtour_qr_codes` row exists | P0 |
| RT-CAM-03 | Create survey-submit campaign without survey template | Admin user | Try to configure survey-submit campaign with no template | Desired outcome: blocked before activation | Confirm current behavior; this is expected to reveal a gap today | P0 |
| RT-CAM-04 | Assign cross-org reference to campaign | Two orgs, reference users in both | Try assigning user from org B to org A campaign | Should be blocked | Confirm no invalid `roadtour_campaign_managers` row | P0 |
| RT-CAM-05 | Pause and archive campaign | Active campaign exists | Use pause/archive UI | Status changes save correctly | `roadtour_campaigns.status` updated with correct timestamps once implemented | P1 |

## C. QR generation and public route tests

| Test ID | Scenario | Preconditions | Steps | Expected result | Verify in DB / system | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| RT-QR-01 | QR generated on activation | Active campaign with assigned reference | Activate campaign | One active QR token exists | `roadtour_qr_codes` has expected campaign/user token row | P0 |
| RT-QR-02 | Friendly URL resolves correctly | Active QR with route fields | Open `/roadtour/<year>/<campaign>/<reference>` and `/rt/<year>/<campaign>/<reference>` | Page loads RoadTour context successfully | Confirm token resolves to same `roadtour_qr_codes` row | P0 |
| RT-QR-03 | Revoked QR is rejected | Existing active QR | Revoke QR then open public route and claim endpoint | Validation should fail | `roadtour_qr_codes.status = revoked`; claim denied | P0 |
| RT-QR-04 | Public QR image fetch works | Valid token | Call `GET /api/roadtour/qr-image/[token]` | PNG returns | Confirm no server error | P1 |
| RT-QR-05 | Repeated page loads do not distort business metrics | Valid token | Reload public route many times without claim | Desired outcome: page opens should not be treated as meaningful claim metric | Compare `usage_count` and scan-event count; expected to expose current inflation gap | P0 |

## D. Claim and reward tests

| Test ID | Scenario | Preconditions | Steps | Expected result | Verify in DB / system | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| RT-CLM-01 | Direct-scan campaign reward success | Valid active direct-scan campaign, authenticated eligible user with shop context | Complete claim flow | Reward succeeds and response returns points/balance | New `roadtour_scan_events` row, `points_transactions` row, possible `roadtour_official_visits` row | P0 |
| RT-CLM-02 | Profile incomplete branch | User missing required profile info | Attempt claim | API returns `PROFILE_INCOMPLETE` branch | No reward transaction created | P0 |
| RT-CLM-03 | Shop required branch | User lacks shop context and route requires it | Attempt claim | API returns `SHOP_REQUIRED` | No reward transaction created | P0 |
| RT-CLM-04 | Duplicate claim blocked | Existing successful claim under same duplicate rule | Repeat claim | Duplicate response returned | No second reward transaction; scan event marked duplicate/rejected as intended | P0 |
| RT-CLM-05 | Reward balance matches transaction outcome | Successful claim | Compare API response balance with SQL balance | Balance values should match | Compare with `v_consumer_points_balance` and latest `points_transactions` | P0 |

## E. Survey tests

| Test ID | Scenario | Preconditions | Steps | Expected result | Verify in DB / system | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| RT-SUR-01 | Survey-submit campaign persists response header | Active survey-submit campaign with template | Complete claim with valid survey answers | One valid response header is created | `roadtour_survey_responses` row exists with campaign, qr, manager, scanner, template ids populated | P0 |
| RT-SUR-02 | Survey-submit campaign persists response items correctly | Same as above | Submit text, single-select, numeric, and photo-like answers where supported | Items map into valid production columns | `roadtour_survey_response_items` rows use `answer_text`, `answer_json`, `answer_number`, or `media_url` appropriately | P0 |
| RT-SUR-03 | Survey-required branch blocks empty submit | Active survey-submit campaign | Attempt claim without required answers | API returns survey-required failure | No reward transaction; no invalid partial response | P0 |
| RT-SUR-04 | Template version or snapshot integrity is acceptable | Existing live template | Submit response, then edit template labels | Historical answers should remain interpretable | Confirm current snapshot columns preserve enough meaning; likely partial today | P1 |

## F. Visit tests

| Test ID | Scenario | Preconditions | Steps | Expected result | Verify in DB / system | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| RT-VIS-01 | Successful claim creates official visit | Direct-scan or survey-submit success with shop context | Complete valid claim | Official visit row created or reused according to duplicate rule | `roadtour_official_visits` row exists with same campaign, manager, shop, visit_date | P0 |
| RT-VIS-02 | Same-day duplicate visit is not double-counted | Existing official visit for same campaign/manager/shop/day | Run second successful attempt same day | No duplicate official-visit row | Unique constraint prevents duplicate official visit | P0 |
| RT-VIS-03 | Visit drill-down in UI matches DB facts | Existing visit with scan event and survey response | Open visit details in UI | Detail view matches DB-linked rows | Check linked `official_scan_event_id` and `official_survey_response_id` | P1 |

## G. WhatsApp tests

| Test ID | Scenario | Preconditions | Steps | Expected result | Verify in DB / system | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| RT-WA-01 | Send QR via WhatsApp | Admin user, valid provider config, valid QR token | Use QR Management send action | Route succeeds and provider returns message id | `roadtour_qr_delivery_logs` entry exists and matches send outcome | P0 |
| RT-WA-02 | Claim alert test send | Admin user, valid claim alert settings | Use test-alert action | Test alert succeeds | `roadtour_claim_notification_logs` row exists with `notification_type = test` | P1 |
| RT-WA-03 | WhatsApp Monitoring reflects all expected send categories | Existing QR sends and claim alerts | Review monitoring UI | Desired future state: all RoadTour WhatsApp traffic visible | Confirm current gap that claim-alert logs are missing from monitoring screen | P1 |

## H. Analytics reconciliation tests

| Test ID | Scenario | Preconditions | Steps | Expected result | Verify in DB / system | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| RT-AN-01 | Total scans KPI matches SQL exact count | Non-trivial scan volume | Compare UI total scans with SQL `count(*)` for matching campaign/org/time window | Values should match | Query `roadtour_scan_events` directly | P0 |
| RT-AN-02 | Top campaign scan counts match SQL | Multiple campaigns with varying scans | Compare UI ranking with SQL grouped count | Order and totals should match | Group by `campaign_id` in `roadtour_scan_events` | P0 |
| RT-AN-03 | Official visit totals match SQL | Multiple visits across campaigns | Compare UI totals with `roadtour_official_visits` count | Values should match | Query `roadtour_official_visits` directly | P1 |
| RT-AN-04 | Date filters actually affect analytics | Different data across date windows | Change date filters in UI | Metrics should change according to selected range | Confirm whether current code applies date filters; expected current gap | P0 |

## I. Regression and deployment-confidence tests

| Test ID | Scenario | Preconditions | Steps | Expected result | Verify in DB / system | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| RT-REG-01 | Production function parity check | Staging/local DB with latest migrations and production schema snapshot available | Diff `record_roadtour_reward` behavior between intended repo state and deployed DB state | Behavior should match intended release baseline | Review function text or run controlled cases | P0 |
| RT-REG-02 | Schema drift check for survey tables | Current code and target DB available | Validate that app insert payloads match target DB schema | No missing required columns and no unknown columns | Compare route payloads to table definitions | P0 |
| RT-REG-03 | Regression check after any auth-policy change | Updated RLS deployed | Re-run RT-SEC-01 to RT-SEC-05 | No role or tenant regressions | DB policy behavior matches expected matrix | P0 |

## Suggested execution order

Run in this order:
1. RT-SEC suite
2. RT-CAM suite
3. RT-QR suite
4. RT-CLM suite
5. RT-SUR suite
6. RT-VIS suite
7. RT-WA suite
8. RT-AN suite
9. RT-REG suite

## Exit criteria before first real campaign

Minimum pass bar:
- all `P0` tests pass
- no cross-org read/write succeeds
- survey-submit flow passes header and item persistence checks
- analytics totals reconcile with SQL for the agreed KPI set
- QR send and claim alert logs are verifiable and supportable
- production function behavior is confirmed against intended release logic

## Testing-plan conclusion

RoadTour does not need a gigantic generic QA sweep first.
It needs a sharp set of high-value tests aimed exactly at the places where the current implementation can mislead operators:
- authorization,
- survey persistence,
- analytics correctness,
- QR governance,
- and production schema drift.