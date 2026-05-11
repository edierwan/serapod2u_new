# RoadTour Module Assessment

Date: 2026-05-10

Assessment scope:
- UI and navigation under Customer & Growth > Marketing > RoadTour
- Public QR/scan journey and friendly RoadTour URLs
- Production database schema from self-hosted Supabase production
- Server routes, direct client-side Supabase usage, RLS, and production-readiness gaps

Source of truth used for this pack:
- Current schema snapshot refreshed from the self-hosted staging Supabase database into `supabase/schemas/current_schema.sql` on 2026-05-12 using a schema-only dump after the RoadTour Event sync work
- Current app code under `app/src/modules/roadtour`, `app/src/app/roadtour`, `app/src/app/api/roadtour`, and shared dashboard/customer-growth wiring
- Current RoadTour-related migrations under `supabase/migrations`

## What RoadTour is supposed to do

RoadTour is positioned as a field-operations campaign module inside Customer & Growth. Based on the current UI and schema, its intended lifecycle is:

1. Admin creates a RoadTour campaign.
2. One or more account managers or references are assigned.
3. QR tokens are generated for the campaign.
4. QR links are distributed, including friendly URLs and WhatsApp delivery.
5. Consumers or participants scan the QR during a visit.
6. The system validates login/profile/shop requirements.
7. The user optionally completes a survey.
8. Reward points are credited.
9. An official visit record and monitoring logs are created.
10. Admin reviews visits, analytics, and WhatsApp delivery status.

## Current status

Overall status: developed but only partially production-ready.

Observed maturity by area:
- Navigation and dashboard shell: developed
- Campaign CRUD and QR management: developed but partial
- Survey builder UI: developed
- Public claim journey: developed but not fully aligned with production schema
- Analytics and monitoring: partially developed
- Security and tenant isolation: not production-ready
- Reporting model: incomplete for real operational use

## Production-readiness summary

Current recommendation: not ready, needs DB/app fixes first.

Most serious reasons:
- RoadTour admin RLS policies are role-based but not org-scoped, so tenant isolation is not enforced at the RoadTour table layer.
- The live `claim-reward` API does not match the production `roadtour_survey_responses` and `roadtour_survey_response_items` schema, so survey-submit campaigns are high risk and likely broken.
- Two different settings surfaces write to `roadtour_settings`, but live claim behavior actually depends on campaign-level fields, so admin configuration is misleading today.
- Analytics screens are present, but several KPI calculations are not reliable enough for real campaign reporting.
- Production `record_roadtour_reward` is behind later repo migrations, so the production DB function does not yet include the newer shop-user balance fallback logic seen in the repository.

## Document index

- [01-current-feature-inventory.md](./01-current-feature-inventory.md)
- [02-db-schema-inventory.md](./02-db-schema-inventory.md)
- [03-roadtour-business-flow.md](./03-roadtour-business-flow.md)
- [04-api-and-server-actions.md](./04-api-and-server-actions.md)
- [05-security-rls-access-review.md](./05-security-rls-access-review.md)
- [06-ui-ux-readiness-review.md](./06-ui-ux-readiness-review.md)
- [07-production-readiness-checklist.md](./07-production-readiness-checklist.md)
- [08-risk-register.md](./08-risk-register.md)
- [09-recommended-schema-improvements.md](./09-recommended-schema-improvements.md)
- [10-recommended-feature-roadmap.md](./10-recommended-feature-roadmap.md)
- [11-testing-plan.md](./11-testing-plan.md)
- [12-final-assessment-summary.md](./12-final-assessment-summary.md)

## Headline findings

- The `/roadtour` admin module shell only checks authentication and organization presence in `app/src/app/roadtour/_lib.ts`; explicit RoadTour authorization is deferred to RLS and selected API routes.
- The RoadTour RLS policies in production use hardcoded role codes such as `SA`, `HQ`, `POWER_USER`, `HQ_ADMIN`, `SUPER_ADMIN`, and `ADMIN`, but they do not restrict access by `org_id`.
- Public scan routes are live through `/scan?rt=...`, `/roadtour/[year]/[campaignSlug]/[referenceSlug]`, and `/rt/[year]/[campaignSlug]/[referenceSlug]`.
- The current production schema contains the RoadTour tables, functions, triggers, and policies, including friendly URL fields on `roadtour_qr_codes` and geolocation columns on `roadtour_scan_events`.
- The repository contains later RoadTour migrations than what is currently reflected in production `current_schema.sql`, so production and repo are not fully aligned.

## High-level conclusion

RoadTour looks like a real module, not a placeholder. The core data model exists, the UI has multiple working screens, the public QR flow exists, and the schema contains the major RoadTour objects.

The problem is not absence of implementation. The problem is implementation alignment and production rigor:
- configuration is split across overlapping screens,
- tenant isolation is not enforced strongly enough,
- analytics are not trustworthy enough,
- and the survey path appears structurally mismatched against production schema.

That combination makes the module unsuitable for first real campaign usage until the blockers in this assessment pack are resolved.