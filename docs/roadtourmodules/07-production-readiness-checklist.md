# 07. Production Readiness Checklist

Status labels:
- PASS
- PARTIAL
- FAIL
- NOT FOUND
- NEEDS DECISION

Risk levels:
- Low
- Medium
- High

## DB / schema readiness

| Item | Status | Evidence | Risk | Suggested action |
| --- | --- | --- | --- | --- |
| Core RoadTour tables exist in production | PASS | `current_schema.sql` contains campaigns, assignments, QR, scans, visits, surveys, settings, delivery logs, claim-alert logs | Low | None |
| Campaign lifecycle fields exist | PARTIAL | `roadtour_campaigns` has `status`, `start_date`, `end_date` | Medium | Add lifecycle timestamps and status history before launch |
| Campaign target model exists | FAIL | Only `region_scope` JSONB found; no campaign target shop/customer table | High | Add explicit target table before first real campaign |
| Survey schema exists | PASS | `roadtour_survey_templates`, `roadtour_survey_template_fields`, `roadtour_survey_responses`, `roadtour_survey_response_items` exist | Low | Keep |
| Survey schema matches live API writes | FAIL | `claim-reward` inserts incomplete `roadtour_survey_responses` rows and uses non-existent response-item `value` column | High | Fix API/schema alignment before any survey-submit campaign |
| Friendly URL routing fields exist | PASS | `roadtour_qr_codes` has `route_year`, `campaign_slug`, `reference_slug`, `short_code`, `canonical_path` plus uniqueness | Low | Keep |
| QR batch tracking exists | FAIL | No batch table or batch id found on `roadtour_qr_codes` | Medium | Add batch model for governance and reporting |
| Visit check-in/check-out model exists | FAIL | `roadtour_official_visits` only stores one row per day, no check-in/out timestamps | High | Add explicit visit lifecycle fields before field rollout |
| Claim-alert log governance exists | PARTIAL | `roadtour_claim_notification_logs` exists, but no org column and no RLS policy was found | Medium | Add org_id, delivery lifecycle fields, and policy coverage |
| Production DB reflects latest repo RoadTour reward function | FAIL | Production `record_roadtour_reward` in `current_schema.sql` lacks later shop-user balance fallback seen in repo migrations | High | Align production DB function with intended current logic |

## RLS / security

| Item | Status | Evidence | Risk | Suggested action |
| --- | --- | --- | --- | --- |
| Main RoadTour tables have RLS enabled | PARTIAL | Most main RoadTour tables have admin/self/public policies | Medium | Keep, but strengthen |
| Tenant/org isolation is enforced by RoadTour RLS | FAIL | Admin policies check role code only, not row org ownership | High | Make all admin RoadTour policies org-scoped |
| Claim notification logs have explicit RoadTour RLS policy | FAIL | No RoadTour claim-notification policy found in production schema snapshot | High | Add explicit policy coverage or server-only access plan |
| Role model is consistent across page shell, APIs, and RLS | FAIL | `roadtour/_lib.ts`, `isAdminUser()`, and production RLS use different logic/vocabularies | High | Unify one authorization model |
| Public scan/image endpoints are rate-limited | NOT FOUND | No rate-limiting layer found in RoadTour code | High | Add rate limit and monitoring |
| Duplicate reward/idempotency is robust under concurrency | PARTIAL | DB function checks duplicates, but not with an explicit idempotency-key design | Medium | Add stronger atomic guard |

## API validation readiness

| Item | Status | Evidence | Risk | Suggested action |
| --- | --- | --- | --- | --- |
| Request-schema validation on RoadTour routes | FAIL | No Zod or equivalent validator found on `claim-reward`, `send-qr-whatsapp`, or `test-claim-alert` | High | Add schema validation |
| Route auth for admin-only send/test endpoints | PASS | `send-qr-whatsapp` and `test-claim-alert` require auth and admin helper pass | Low | Keep |
| Public claim route surface is narrow and hardened | FAIL | `claim-reward` is public, service-role backed, multi-responsibility, and not rate-limited | High | Split or harden route |
| QR image endpoint abuse protection exists | NOT FOUND | Public image endpoint has token regex only | Medium | Add rate limiting and access telemetry |
| Schema-drift failures are loudly surfaced | PARTIAL | `claim-reward` includes fallback/retry behavior, but can silently drop geo/phone fields | Medium | Convert silent downgrade to explicit operational alert |

## UI readiness

| Item | Status | Evidence | Risk | Suggested action |
| --- | --- | --- | --- | --- |
| Navigation shell is complete | PASS | Customer & Growth entry, RoadTour landing, top nav, dashboard wiring all present | Low | Keep |
| Campaign management UI is complete enough for real campaigns | PARTIAL | Strong CRUD shell, but no survey-template assignment or target-shop model | High | Complete campaign configuration model |
| QR management UI is production-ready | PARTIAL | Preview/send/revoke exist, but no batch management or revoke audit | Medium | Add governance and confirmations |
| Survey builder is production-ready | PARTIAL | Builder UI is strong, but end-to-end survey submit flow is not aligned | High | Fix flow before rollout |
| Settings are a single source of truth | FAIL | Both `RoadtourSettingsView` and `RoadtourRewardSettings` update `roadtour_settings` | High | Collapse to one authoritative settings surface |
| Field-ops UX is truly field-ready | PARTIAL | Visits screen exists, but no actual check-in/out lifecycle exists | High | Add explicit field workflow |

## Reporting readiness

| Item | Status | Evidence | Risk | Suggested action |
| --- | --- | --- | --- | --- |
| Base fact tables exist for campaign/QR/scan/visit/survey | PASS | Production schema includes the main objects | Low | Keep |
| KPI calculations in current UI are trustworthy | FAIL | `totalScans` limited to 100 rows; `topCampaigns.scan_count` not true scan count | High | Fix analytics queries before use |
| Campaign target denominator exists for coverage reporting | FAIL | No target-list table found | High | Add target model |
| Export capability exists | NOT FOUND | No RoadTour export endpoint or export UI found | Medium | Add CSV/PDF export plan |
| Reporting views/materialized summaries exist | NOT FOUND | No RoadTour-specific reporting view found in production schema | Medium | Add reporting view or derived fact layer |

## QR / scan readiness

| Item | Status | Evidence | Risk | Suggested action |
| --- | --- | --- | --- | --- |
| Friendly URL support exists | PASS | Trigger and canonical path fields present; routes implemented | Low | Keep |
| Token validation enforces campaign status/date | PASS | `validate_roadtour_qr_token()` checks status and Malaysia-timezone date window | Low | Keep |
| QR usage metric reflects true scan demand | FAIL | `validate_roadtour_qr_token()` increments `usage_count` on validation | Medium | Separate page-open metric from claim metric |
| QR send logging is reliable | PARTIAL | Client inserts `roadtour_qr_delivery_logs` after send | Medium | Move log insert server-side |
| Duplicate scan/claim protection is launch-ready | PARTIAL | Duplicate rules exist, but no explicit public-route idempotency key | Medium | Add stronger atomic safeguards |

## WhatsApp integration readiness

| Item | Status | Evidence | Risk | Suggested action |
| --- | --- | --- | --- | --- |
| QR send route exists | PASS | `/api/roadtour/send-qr-whatsapp` implemented | Low | Keep |
| Claim alert notification flow exists | PASS | `sendRoadtourClaimNotifications()` and test-alert route implemented | Low | Keep |
| WhatsApp monitoring covers all RoadTour sends | FAIL | Monitoring UI covers QR delivery logs only, not claim alert logs | Medium | Unify monitoring screen |
| Phone normalization is consistent across RoadTour logs | PARTIAL | Claim alert logs normalize phone; QR delivery logs do not show equivalent DB constraint/trigger | Medium | Normalize QR delivery logs too |

## Audit / logging readiness

| Item | Status | Evidence | Risk | Suggested action |
| --- | --- | --- | --- | --- |
| Timestamps exist on key RoadTour tables | PASS | Most major tables have `created_at`, many have `updated_at` | Low | Keep |
| Actor audit exists for all critical actions | FAIL | Missing actor fields on QR/log tables and weak assignment churn history | High | Add actor + reason fields or audit log table |
| Claim alerts preserve rendered message and template | PASS | `roadtour_claim_notification_logs` stores both | Low | Keep |
| QR issuance / revocation audit is sufficient | FAIL | No `generated_by`, `revoked_by`, `revoked_reason` on `roadtour_qr_codes` | Medium | Add audit columns or companion log table |

## Error handling readiness

| Item | Status | Evidence | Risk | Suggested action |
| --- | --- | --- | --- | --- |
| Admin screens show loading and error states | PARTIAL | Loading spinners and toasts exist on most screens | Low | Add stronger inline recovery where needed |
| Public claim flow has specific branch errors | PASS | `PROFILE_INCOMPLETE`, `SHOP_REQUIRED`, `SURVEY_REQUIRED`, `DUPLICATE`, etc. | Low | Keep |
| Operational failures are observable, not silent | PARTIAL | Some schema-drift errors are explicit, but some data-loss fallback is silent | Medium | Promote operational alerts and logs |

## Testing readiness

| Item | Status | Evidence | Risk | Suggested action |
| --- | --- | --- | --- | --- |
| Dedicated manual RoadTour test scripts exist historically | PARTIAL | Existing docs include older RoadTour test-script artifacts | Medium | Refresh with this new test plan |
| Current automated RoadTour tests exist | NOT FOUND | No RoadTour-specific automated test suite was found during this assessment | High | Add focused integration tests |
| Role-based security tests exist | NOT FOUND | No evidence found | High | Add explicit multi-role test coverage |

## Backup / rollback readiness

| Item | Status | Evidence | Risk | Suggested action |
| --- | --- | --- | --- | --- |
| Schema evolution history exists | PASS | RoadTour migrations exist under `supabase/migrations` | Low | Keep |
| Production is aligned with latest intended migrations | FAIL | Production function snapshot lags later repo migration intent | High | Add deploy verification for DB drift |
| RoadTour-specific rollback or cutover runbook exists | NOT FOUND | No dedicated RoadTour runbook found in current docs pack | Medium | Create rollout and rollback doc before launch |

## Monitoring readiness

| Item | Status | Evidence | Risk | Suggested action |
| --- | --- | --- | --- | --- |
| Screen-level monitoring exists for QR delivery and analytics | PARTIAL | Monitoring and analytics screens exist, but coverage is incomplete | Medium | Expand and harden them |
| Public-route abuse monitoring exists | NOT FOUND | No rate-limit or abuse-monitoring implementation found | High | Add request telemetry and alerting |
| Data-quality monitoring exists for RoadTour reporting | NOT FOUND | No data-quality checks or reconciliation jobs found | High | Add analytics reconciliation checks |

## Checklist conclusion

RoadTour is not starting from zero. Many core building blocks already pass a basic existence check.

The module still fails the production-readiness bar because the blockers are not cosmetic:
- org-safe access control fails,
- survey persistence alignment fails,
- analytics trustworthiness fails,
- and settings truth is split.

The fastest path to readiness is not adding more screens first. It is tightening the current ones so their behavior matches what operators will assume they already do.