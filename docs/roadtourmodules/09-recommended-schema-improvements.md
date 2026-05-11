# 09. Recommended Schema Improvements

This document proposes schema and policy improvements only.

No migrations were created in this assessment.
No production or staging data was modified.

## Principles used

- Prefer structured facts over free text wherever reporting depends on the value.
- Capture actor and timestamp fields at the moment an important RoadTour state changes.
- Make org isolation explicit in policy design, not just implied in UI filters.
- Make new records correct from day one, especially where historical backfill would be hard or impossible.

## Proposed improvements

| Table / object | Proposed change | Why it is needed | Reporting benefit | Required before launch? | Risk if not added now |
| --- | --- | --- | --- | --- | --- |
| `roadtour_campaigns` | Add `activated_at`, `activated_by`, `paused_at`, `paused_by`, `completed_at`, `completed_by`, `archived_at`, `archived_by` | Current lifecycle is status-only | Enables lifecycle duration reporting and accountable status changes | Yes | Campaign history remains opaque |
| `roadtour_campaigns` | Add a DB check or trigger requiring `survey_template_id` when `reward_mode = 'survey_submit'` | Prevents invalid campaign configuration | Eliminates survey-submit campaigns with missing template linkage | Yes | Admin can create misleading/broken survey campaigns |
| New object: `roadtour_campaign_targets` | Create explicit target table for shops and optionally target customers | `region_scope` alone is not enough for coverage reporting or field planning | Supports planned-vs-visited, coverage rate, and route execution metrics | Yes | Coverage reporting will be weak from day one |
| New object: `roadtour_campaign_status_history` | Store each status transition with actor, timestamp, note, and source | Current campaign lifecycle is not historically auditable | Enables full audit trail and SLA reporting | Yes | Status changes remain hard to reconstruct |
| `roadtour_campaign_managers` | Add `removed_at`, `removed_by`, `assignment_source`, and optionally `org_id` snapshot | Current assignment history is a boolean flip only | Supports assignment churn and staffing reports | Yes | Assignment reporting stays ambiguous |
| New object: `roadtour_qr_batches` and `roadtour_qr_codes.batch_id` | Group QR generation into auditable batches | Current QR table cannot explain who generated which wave of QR codes | Supports batch send, print, revoke, and conversion reporting | Yes | QR governance becomes messy at scale |
| `roadtour_qr_codes` | Add `generated_by`, `generated_at`, `revoked_by`, `revoked_at`, `revoked_reason`, `distribution_channel` | QR lifecycle currently lacks operator audit fields | Supports issuance/revocation audit and QR distribution reporting | Yes | QR operations will be weakly auditable |
| `roadtour_qr_delivery_logs` | Add `org_id`, `retry_count`, `provider_payload`, `request_payload`, and E164 constraint / normalization trigger for `phone_number` | QR delivery logs are structurally thinner than claim-alert logs | Improves provider troubleshooting and cross-campaign delivery reporting | Yes | QR delivery reporting stays inconsistent and hard to debug |
| `roadtour_scan_events` | Add `request_id`, `idempotency_key`, `ip_hash`, `user_agent`, `scan_channel`, and optionally `validated_at` vs `rewarded_at` timestamps | Needed for abuse control, forensics, and cleaner funnel reporting | Enables fraud analysis and true scan/claim funnel reporting | Yes | Abuse analysis and reliable funnel metrics remain weak |
| `roadtour_official_visits` | Add `checked_in_at`, `checked_out_at`, `visit_outcome`, `visit_duration_seconds`, `manual_override_by`, `manual_override_reason`, `gps_status_snapshot` | Current visit table is too thin for field-ops analytics | Enables productivity, punctuality, and outcome reporting | Yes | Field operations cannot be measured cleanly |
| `roadtour_survey_templates` | Add `version`, `published_at`, `published_by`, `archived_at`, `archived_by` | UI already implies versioning; schema does not support it | Allows version-aware survey reporting and template governance | Yes | Survey governance remains weak and UI/schema remain mismatched |
| `roadtour_survey_template_fields` | Add unique constraint on `(template_id, field_key)` | Duplicate field keys would break reliable survey answer interpretation | Ensures answer keys remain unique and reportable | Yes | Analytics could be corrupted by duplicate keys |
| `roadtour_survey_responses` | Add `org_id`, `template_version`, `consumer_phone_snapshot`, and possibly `submission_source` | Current response header lacks direct org and version snapshots | Simplifies reporting and preserves context even if templates later change | Yes | Survey reporting will depend on fragile joins and mutable template state |
| `roadtour_survey_response_items` | Consider adding `answer_boolean` and `answer_date` if product wants strongly typed reporting; otherwise keep current flexible model but enforce a clean app mapping | Some answers are easier to report when typed explicitly | Improves downstream analytics and BI transformations | Optional later | Some field types remain cumbersome to aggregate |
| `roadtour_claim_notification_logs` | Add `org_id`, `delivered_at`, `updated_at`, `retry_count`, `provider_payload` | Current alert log is helpful but not fully operational | Enables claim-alert SLA and troubleshooting reports | Should-have soon | Claim alert ops remain harder than QR delivery ops |
| New object: `roadtour_event_audit_log` | Capture structured events like campaign create, activate, assign, QR generate, send, revoke, claim-failed, claim-duplicate | Important operator actions are not centrally auditable today | Strong audit, incident review, and compliance value | Yes | Operational investigations will rely on partial evidence |
| Policy layer | Replace role-only RoadTour admin policies with org-scoped policies using campaign/org ownership checks | Current RLS is the biggest production blocker | Tenant-safe reporting and mutation protection | Yes | Cross-org read/write remains possible |
| Reporting layer | Add RoadTour reporting fact view or materialized aggregate(s) for campaign, scan, visit, and delivery summary | Current analytics page computes ad hoc in the browser | More reliable, faster, and reusable reporting | Should-have soon | KPIs remain inconsistent across screens |

## Recommended launch-critical set

If only the minimum schema work can be done before first real campaign, prioritize:
1. org-scoped RoadTour RLS and policy cleanup
2. campaign target model
3. survey-submit integrity constraint on campaigns
4. QR lifecycle audit fields or QR batch model
5. visit lifecycle expansion
6. survey template versioning
7. response header context snapshots

## Recommendations tied to current production weaknesses

### Because `roadtour_settings` is not the true live source of claim behavior today

Schema-side recommendation:
- keep `roadtour_settings` as org defaults,
- but enforce campaign validity so campaign rows are always self-sufficient once activated.

Practical rule:
- an active campaign should not rely on mutable org defaults to define reward mode or survey template.

### Because RoadTour reporting must be correct from day one

Structured capture needed at record creation time:
- target shop identity
- target assignment identity
- QR batch identity
- exact lifecycle timestamps
- explicit visit outcomes
- survey template version
- operator audit fields

These are much harder to reconstruct later than they are to store when the event happens.

## Schema improvement conclusion

The current RoadTour schema is a solid MVP base. It is not far from being production-grade, but the missing pieces are exactly the pieces that become painful after launch:
- target coverage,
- lifecycle history,
- operator auditability,
- org-safe policy enforcement,
- and clean reporting keys.

If these are added before the first real campaign, future reporting quality will be materially better and the module will be much easier to support operationally.