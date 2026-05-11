# 05. Security, RLS, And Access Review

This review is based on:
- production RoadTour RLS policies in `supabase/schemas/current_schema.sql`
- page-context logic in `app/src/app/roadtour/_lib.ts` and `app/src/app/customer-growth/_lib.ts`
- admin helper checks in `app/src/app/api/settings/whatsapp/_utils.ts`
- public RoadTour route handling in `app/middleware.ts` and `app/src/app/api/roadtour/*`

## Security summary

Current conclusion:
- RoadTour has RLS on most major tables, which is better than having no DB policy layer.
- However, the production RoadTour admin policies are not org-scoped.
- Because RoadTour admin screens mutate data directly from the client, missing org isolation in RLS is a major production blocker.

Highest-risk security finding:
- A user whose `users.role_code` matches one of the hardcoded RoadTour admin role codes can potentially read or mutate RoadTour records outside their own organization if they bypass the UI’s `org_id` filters and call Supabase directly from the browser.

## Observed enforcement layers

## 1. Page shell access

Observed in code:
- `app/src/app/roadtour/_lib.ts` requires only:
  - authenticated user
  - a resolved organization id

Not enforced there:
- RoadTour-specific permission
- admin-only role requirement
- org-specific feature flag

Effect:
- any authenticated user with an organization can reach the RoadTour shell route.
- whether data actually loads then depends on RLS and per-route checks.

## 2. Client-side RoadTour admin screens

Observed in code:
- Campaigns, QR management, surveys, visits, analytics, and settings use browser Supabase client access.
- These screens rely on DB policy enforcement rather than server routes.

Effect:
- RLS is the real enforcement boundary for most RoadTour admin behavior.
- If RLS is too broad, browser users can do too much.

## 3. Admin-only API routes

Observed in code:
- `POST /api/roadtour/send-qr-whatsapp`
- `POST /api/roadtour/test-claim-alert`

Enforcement used:
- authenticated session required
- `isAdminUser()` helper checks role level `<= 20` or role code in `super_admin`, `admin`, `org_admin`

Effect:
- these routes are narrower than the page shell.
- but their admin vocabulary does not exactly match the production RLS vocabulary.

## 4. Public scan surface

Observed in code and middleware:
- `/scan?rt=...` is public
- `/roadtour/[year]/[campaignSlug]/[referenceSlug]` is public
- `/rt/[year]/[campaignSlug]/[referenceSlug]` is public
- `POST /api/roadtour/claim-reward` is public
- `GET /api/roadtour/qr-image/[token]` is public

Effect:
- public use is intentional for campaign participation
- abuse and throttling protections therefore matter a lot

## Role matrix by capability

Observed by code and policy, not by assumption.

| Capability | Super Admin | HQ Admin | Power User | Account Manager / field staff | Manufacturer / Distributor / Shop admin | Customer / guest | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Reach `/roadtour` shell | Yes | Yes | Yes | Yes if authenticated and attached to an org | Yes if authenticated and attached to an org | No, unless authenticated with org | `app/src/app/roadtour/_lib.ts` only checks auth + org |
| Read/write main RoadTour admin tables from browser client | Yes | Yes | Yes if `role_code = POWER_USER` in production RLS | No dedicated policy found | No unless their `role_code` is one of the hardcoded admin codes | No | Production policies `roadtour_*_admin_select/manage` |
| Read own campaign-assignment link | not relevant | not relevant | not relevant | Yes | Yes if assigned user row matches auth uid | No | `roadtour_campaign_managers_self_select` |
| Read own scan events / survey responses | not relevant | not relevant | not relevant | Yes if they are the scanning auth user | Possibly yes if they are the scanning auth user | Yes if they are the scanning auth user | `roadtour_scan_events_self_select`, `roadtour_survey_responses_self_select`, `roadtour_survey_response_items_self_select` |
| Insert own survey responses / response items | not relevant | not relevant | not relevant | Yes if they are the scanning auth user | Yes if they are the scanning auth user | Yes if they are the scanning auth user | `roadtour_survey_responses_self_insert`, `roadtour_survey_response_items_self_insert` |
| Send QR WhatsApp | Yes | Yes if role level meets admin helper check | Unknown by title alone; helper allows only role level `<= 20` or code `org_admin` | No dedicated field-staff allowance found | Unknown unless helper sees admin role level or code | No | `isAdminUser()` in `app/src/app/api/settings/whatsapp/_utils.ts` |
| Send test claim alert | Same as send QR WhatsApp | Same as send QR WhatsApp | Same caveat | No dedicated allowance found | Same caveat | No | `POST /api/roadtour/test-claim-alert` |
| Scan QR / claim reward | Yes | Yes | Yes | Yes if public flow and claim prerequisites pass | Yes if public flow and claim prerequisites pass | Yes if public flow and claim prerequisites pass | public middleware and public claim route |
| View active survey template definitions for public claim rendering | Yes | Yes | Yes | Yes | Yes | Yes when template is active | `roadtour_survey_templates_public_select`, `roadtour_survey_template_fields_public_select` |

## Who can do what?

Based on observed implementation:

| Action | Current answer | Evidence |
| --- | --- | --- |
| Who can create campaigns? | Any authenticated browser user can reach the screen, but actual DB create should only succeed for users matching RoadTour admin RLS role codes | `app/src/app/roadtour/_lib.ts`, `roadtour_campaigns_admin_manage` |
| Who can edit campaigns? | Same as create campaigns | `RoadtourCampaignsView.tsx`, `roadtour_campaigns_admin_manage` |
| Who can delete or archive campaigns? | Archive-like status changes are available in UI; no hard delete flow was found in the RoadTour campaigns screen | `RoadtourCampaignsView.tsx` |
| Who can generate QR codes? | Admin-side campaign activation and assignment flow generates them through direct browser Supabase writes | `syncCampaignQrs()` in `RoadtourCampaignsView.tsx`, `roadtour_qr_codes_admin_manage` |
| Who can scan QR codes? | Public participants through public routes | `app/middleware.ts`, public scan pages, `claim-reward` route |
| Who can view analytics? | UI shell is broadly reachable to authenticated users, but data depends on RoadTour admin RLS | `RoadtourAnalyticsView.tsx`, `roadtour_*_admin_select` |
| Who can export data? | Unknown / not found. No RoadTour export endpoint or export action was found | code search |
| Who can manage settings? | Same pattern as other admin screens: browser UI reachable broadly, DB writes depend on RLS; test-alert send also requires admin helper pass | `RoadtourSettingsView.tsx`, `RoadtourRewardSettings.tsx`, `roadtour_settings_admin_manage`, `isAdminUser()` |

## Production RLS review

## Policies that exist

Admin-style select/manage policies found on:
- `roadtour_campaigns`
- `roadtour_campaign_managers`
- `roadtour_qr_codes`
- `roadtour_qr_delivery_logs`
- `roadtour_scan_events`
- `roadtour_official_visits`
- `roadtour_settings`
- `roadtour_survey_templates`
- `roadtour_survey_template_fields`
- `roadtour_survey_responses`
- `roadtour_survey_response_items`

Self/public policies found on:
- `roadtour_campaign_managers_self_select`
- `roadtour_scan_events_self_select`
- `roadtour_survey_responses_self_insert`
- `roadtour_survey_responses_self_select`
- `roadtour_survey_response_items_self_insert`
- `roadtour_survey_response_items_self_select`
- `roadtour_survey_templates_public_select`
- `roadtour_survey_template_fields_public_select`

No RoadTour policy found on:
- `roadtour_claim_notification_logs`

## Most important RLS defect: no org isolation in admin policies

Observed policy pattern:
- the RoadTour admin policies check only `auth.uid()` and whether the user’s `role_code` is in a hardcoded admin list.
- they do not check whether the RoadTour row belongs to the same `organization_id` as the authenticated user.

Examples:
- `roadtour_campaigns_admin_select`
- `roadtour_campaigns_admin_manage`
- `roadtour_qr_codes_admin_select`
- `roadtour_qr_codes_admin_manage`
- and the equivalent policies on other RoadTour tables

Risk:
- High.

Why:
- The UI usually filters by `org_id = companyId` in browser queries.
- But a user can bypass those UI filters and issue custom Supabase queries from the browser.
- Because the policy itself does not enforce org matching, the database may still return or mutate cross-org RoadTour rows.

This is the single most important security blocker in the current RoadTour implementation.

## Role-code vocabulary mismatch

Observed mismatch:
- Production RoadTour RLS uses role codes such as `SA`, `HQ`, `POWER_USER`, `HQ_ADMIN`, `SUPER_ADMIN`, and `ADMIN`.
- App helper `isAdminUser()` uses role level `<= 20` or role codes `super_admin`, `admin`, `org_admin`.
- General permission documentation in `app/src/hooks/usePermissions.ts` describes role taxonomy including `HQ_ADMIN`, `MANU_ADMIN`, `DIST_ADMIN`, `SHOP_MANAGER`, `USER`, and `GUEST`.

Risk:
- Medium to high.

Why:
- The same human role can be treated differently by UI routing, helper APIs, and RLS.
- This creates both security ambiguity and operational confusion.

## Tenant / org isolation review

Observed good points:
- Core RoadTour tables often carry `org_id` directly or can derive it through `campaign_id`.
- Many UI queries apply an org filter in the component query itself.

Observed weak points:
- RLS policy layer is not org-scoped.
- `loadEligibleReferences()` in `RoadtourCampaignsView.tsx` does not explicitly filter by org in code.
- No org column exists on `roadtour_qr_delivery_logs` or `roadtour_claim_notification_logs`, so direct log filtering depends on joins or external discipline.

Conclusion:
- Tenant structure exists in the schema.
- Tenant isolation is not enforced strongly enough in the policy layer.

## User-assignment isolation review

Observed implementation:
- Campaign assignments are in `roadtour_campaign_managers`.
- There is a self-select policy for assigned users.
- The assignment UI loads users by `can_be_reference = true` and `is_active = true`.

Weakness:
- No explicit same-org filter in component code.
- No explicit DB-level constraint that assigned users must belong to the same org as the campaign.

Risk:
- Medium.

## Public QR access risk

Public surfaces:
- friendly URLs
- `/scan?rt=...`
- `GET /api/roadtour/qr-image/[token]`
- `POST /api/roadtour/claim-reward`

Risk review:
- Public access is expected for campaign participation.
- There is no rate limiting or abuse throttling visible in the RoadTour claim/image routes.
- `validate_roadtour_qr_token()` increments `usage_count` during validation, which makes public refresh/reload traffic affect analytics.

## Scan abuse and idempotency review

Observed protections:
- `record_roadtour_reward()` checks duplicate claim counts based on configured duplicate rule.
- `roadtour_official_visits` has a unique constraint on campaign/account-manager/shop/date.

Observed weaknesses:
- Reward duplicate logic is not implemented as a fully atomic idempotency key pattern.
- Public claim route has no rate limiting.
- A malicious actor can create many `opened` scan events before reward failure or duplicate handling ends the flow.

Risk:
- High for analytics quality, medium for financial abuse depending on traffic and concurrency.

## Sensitive data exposure review

Sensitive RoadTour data observed:
- consumer phone in `roadtour_scan_events`
- geolocation fields in `roadtour_scan_events`
- phone numbers in QR delivery logs and claim notification logs
- rendered WhatsApp claim-alert messages in `roadtour_claim_notification_logs`

Security concern:
- If admin-role users are not org-isolated by RLS, those users may be able to read cross-org PII and location data.

## Wrong-role modification risk

Current risk:
- High.

Reason:
- A user with a matching admin-style role code may be able to mutate RoadTour rows across tenant boundaries because the DB policies are not org-scoped.
- Since many admin mutations are client-side Supabase writes, this is not a theoretical issue. It is exactly the path the UI uses.

## Security review conclusion

RoadTour is not missing security controls entirely. It already has:
- RLS on most main tables,
- self/public policies for consumer-side survey access,
- admin checks on selected API routes.

But the current protection model is not production-ready because:
- org isolation is missing from admin RLS,
- role-code logic is inconsistent across layers,
- public scan surfaces are not rate-limited,
- and a service-role public claim route carries too much responsibility for too little validation.

Recommended immediate priority order:
1. make RoadTour admin RLS org-scoped,
2. align one consistent role vocabulary across UI, helper APIs, and DB policies,
3. harden public claim/image endpoints with rate limiting and request validation,
4. move critical admin writes behind server routes or server actions where practical.