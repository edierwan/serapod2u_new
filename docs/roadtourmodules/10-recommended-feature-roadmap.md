# 10. Recommended Feature Roadmap

This roadmap is intentionally pragmatic.

It does not recommend adding more visible surface area first.
It recommends making the existing RoadTour surface trustworthy enough to support a real campaign.

## Roadmap principle

Do not expand RoadTour breadth until the current depth is safe.

That means the first milestone is not “more features.”
The first milestone is:
- secure tenant isolation,
- correct survey persistence,
- trustworthy campaign configuration,
- and accurate reporting.

## Must-have before first real campaign

## 1. Security and tenant isolation hardening

Why first:
- This is the highest-severity blocker because RoadTour admin behavior currently relies heavily on client-side Supabase access backed by RLS.
- If RLS is not org-scoped, every other improvement sits on top of an unsafe foundation.

Work included:
- make all RoadTour admin policies org-scoped
- align one consistent role model across page shell, API helpers, and DB policies
- decide whether `roadtour_claim_notification_logs` is protected by RLS or intentionally server-only
- add rate limiting and telemetry for public claim/image endpoints

Release outcome:
- cross-org RoadTour reads/writes are no longer possible through browser clients
- public surfaces are no longer completely open to spam patterns

## 2. Survey-submit campaign repair

Why second:
- Survey-backed campaigns are one of the headline RoadTour behaviors, but the current production schema and live claim route are not aligned.

Work included:
- align `claim-reward` inserts with production `roadtour_survey_responses` and `roadtour_survey_response_items`
- require campaign `survey_template_id` when `reward_mode = 'survey_submit'`
- make the campaign form expose and validate survey template selection
- block activation of survey-submit campaigns when configuration is incomplete
- decide whether survey templates need publish/version workflow now or soon after launch

Release outcome:
- survey-submit campaigns become a reliable supported mode instead of a high-risk path

## 3. Campaign target model and assignment integrity

Why third:
- Without explicit targets, the module cannot answer the most basic field question: what percentage of planned locations were covered?

Work included:
- add campaign target table for shops and optionally customer segments
- enforce same-org assignment rules for campaign managers / references
- clarify whether “reference” and “account manager” are truly the same business actor
- define campaign coverage denominator and target import flow

Release outcome:
- campaign planning becomes measurable
- field coverage reporting becomes meaningful

## 4. QR governance and auditable delivery

Why fourth:
- QR generation exists, but governance around issuance, send history, and revocation is too thin for production scale.

Work included:
- add QR batch model or equivalent issuance grouping
- add `generated_by`, `revoked_by`, `revoked_reason`, and related audit fields
- move QR delivery-log creation fully server-side into the send route
- separate page-open validation metrics from meaningful conversion metrics

Release outcome:
- QR operations become auditable and supportable

## 5. Analytics truth and operational reporting baseline

Why fifth:
- Current analytics UI is persuasive enough to be trusted, but not accurate enough to deserve that trust.

Work included:
- replace limited-count scan calculations with exact counts or reporting views
- fix top-campaign ranking logic
- add reporting queries for campaign, manager, visit, survey, and delivery summaries
- define core business KPIs explicitly before coding them
- add at least CSV export for campaign and visit reporting

Release outcome:
- the first real campaign can be monitored without manual SQL reconciliation for every KPI

## 6. One settings authority

Why sixth:
- Duplicate settings surfaces create operator confusion and break expectation alignment.

Work included:
- choose one authoritative RoadTour settings surface
- define which values are org defaults versus campaign-time snapshots
- make UI copy clearly explain inheritance behavior
- remove or redirect the secondary settings surface

Release outcome:
- admin expectations match live campaign behavior

## Should-have soon after first real campaign launch

## 7. True field-visit workflow

Work included:
- add check-in/check-out model
- add visit outcome taxonomy
- capture duration and GPS status snapshots
- add visit notes with actor attribution

Value:
- turns RoadTour from campaign-triggered reward flow into a true field-operations module

## 8. Unified WhatsApp operations console

Work included:
- combine QR delivery logs and claim-alert logs in one monitoring surface
- add resend, retry, and provider-debug visibility
- add failure segmentation by campaign, manager, and time window

Value:
- reduces operator confusion and support time

## 9. Survey governance improvements

Work included:
- survey template versioning
- publish/archive flow
- immutable template snapshots for live campaigns
- import/export for survey definitions

Value:
- protects reporting integrity and reduces accidental template drift

## 10. Automated integration and security tests

Work included:
- role-based access tests
- survey-submit end-to-end tests
- QR generation and revoke tests
- analytics reconciliation tests
- public route rate-limit tests

Value:
- prevents regression after launch hardening

## 11. Rollout runbook and production verification

Work included:
- prelaunch checklist
- schema drift verification between repo and production
- rollback steps for RoadTour-specific changes
- operational ownership for incidents and data-quality alerts

Value:
- closes the gap between technical readiness and deploy readiness

## Nice-to-have later

## 12. Bulk QR print/export kit

Possible features:
- printable QR sheets
- branch pack export
- QR batch ZIP package

## 13. Route planning and territory tools

Possible features:
- field route planning
- target clustering
- planned versus completed route progress

## 14. Field productivity scorecards

Possible features:
- account manager scorecards
- visit success rate
- conversion rate from QR send to claim to official visit

## 15. Offline-friendly field workflow

Possible features:
- delayed sync for visit capture
- offline drafts
- signal-loss handling

## 16. Richer campaign closeout pack

Possible features:
- campaign postmortem summary
- ROI/export pack
- success/failure reason taxonomy

## Suggested implementation order

Recommended order of execution:
1. security / org-scoped RLS / public-route hardening
2. survey-submit repair and campaign validation
3. target model and assignment integrity
4. QR governance and server-side audit logging
5. analytics correctness and export baseline
6. single settings authority
7. field-visit lifecycle expansion
8. unified WhatsApp operations console
9. survey governance versioning
10. automated tests and rollout runbook

## Roadmap conclusion

The best next move is not adding more tabs.
The best next move is making the current tabs honest.

Once the existing RoadTour surfaces are secure, correctly wired, and measurable, the module will have a strong enough base to justify the later operator-experience enhancements.