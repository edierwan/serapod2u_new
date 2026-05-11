# 04. API And Server Actions

This document covers:
- HTTP endpoints under `app/src/app/api/roadtour`
- Server-side helper functions that directly affect RoadTour behavior
- Direct client-side Supabase data access patterns used by RoadTour admin screens

## HTTP routes

## `POST /api/roadtour/claim-reward`

File:
- `app/src/app/api/roadtour/claim-reward/route.ts`

Purpose:
- Main public claim endpoint for the RoadTour reward flow.
- Handles QR validation, optional auth resolution, profile/shop/survey gating, scan-event insertion, survey persistence, reward credit, and claim-alert notification.

Middleware/access posture:
- Public path via `app/middleware.ts`
- The route itself uses `createAdminClient()` and therefore runs with service-role DB access on the server.

Request payload observed in code:
- `token` required
- `shop_id` optional
- `consumer_phone` optional
- `consumer_name` optional
- `survey_answers` optional
- `geolocation` optional
- `login_email` optional
- `login_password` optional
- `consumer_confirmation` optional

Response payload observed in code:
- Success:
  - `message`
  - `points_awarded`
  - `balance_after`
  - `total_balance`
  - `scan_event_id`
  - `survey_response_id`
- Controlled error branches:
  - `PROFILE_INCOMPLETE`
  - `SHOP_REQUIRED`
  - `SURVEY_REQUIRED`
  - `DUPLICATE`
  - `INVALID`
  - `EXPIRED`
  - schema-mismatch and reward-processing failures

DB objects touched:
- `users`
- `organizations`
- `roadtour_scan_events`
- `roadtour_survey_responses`
- `roadtour_survey_response_items`
- `roadtour_claim_notification_logs` through helper
- `validate_roadtour_qr_token()`
- `record_roadtour_reward()`
- `v_consumer_points_balance`
- `points_transactions` indirectly via `record_roadtour_reward()`
- `roadtour_official_visits` indirectly via `record_roadtour_reward()`

Validation present:
- Checks only that `token` exists before deeper logic starts.
- Applies profile/shop/survey branching after QR validation.
- Contains geolocation normalization helpers and schema-drift fallback handling.

Validation missing:
- No Zod or schema validator for request body shape.
- No explicit max-size guard for `survey_answers` or geolocation payload.
- No rate limiting.
- No anti-automation or abuse throttling.

Error handling quality:
- Better than average in terms of branch-specific error codes.
- Weak from a hardening perspective because it mixes many responsibilities in one service-role public route.
- Includes a fallback that silently drops geo and phone fields if production schema is behind.

Production safety assessment:
- Not safe enough yet.

Reasons:
- Public endpoint with service-role DB access.
- Optional `login_password` travels in request JSON.
- Survey inserts do not match production table requirements.
- Duplicate prevention is delegated to a DB function that is not fully atomic.
- No rate limiting or anti-abuse guard is present.

## `POST /api/roadtour/send-qr-whatsapp`

File:
- `app/src/app/api/roadtour/send-qr-whatsapp/route.ts`

Purpose:
- Sends a RoadTour QR image through the configured WhatsApp gateway.

Auth and role requirement:
- Requires authenticated user.
- Calls `isAdminUser()` from `app/src/app/api/settings/whatsapp/_utils.ts`.
- `isAdminUser()` allows admin behavior for role level `<= 20` or role codes `super_admin`, `admin`, `org_admin`.

Request payload:
- `phone`
- `token`
- `campaignName`
- `userName`

Response payload:
- Success: `{ ok: true, messageId }`
- Failure: `{ error, step? }`

DB objects touched:
- `users`
- `notification_provider_configs`
- `roadtour_qr_codes` indirectly through token resolution helper
- no direct log-table insert inside the route itself

Validation present:
- checks auth
- checks admin eligibility
- checks `phone` and `token`
- checks gateway config presence
- preflight HEAD request against the QR-image endpoint before send

Validation missing:
- No request-schema validator
- No phone normalization inside the route before passing to the provider payload, beyond digit stripping for recipient digits
- No rate limiting
- No idempotency guard

Error handling quality:
- Good operational logging and explicit error-step returns.
- Better structured than `claim-reward`.

Production safety assessment:
- Partial.

Reasons:
- Route auth is stronger than the public claim route.
- But audit/log integrity is incomplete because the client inserts `roadtour_qr_delivery_logs` after the route returns success.

## `GET /api/roadtour/qr-image/[token]`

File:
- `app/src/app/api/roadtour/qr-image/[token]/route.ts`

Purpose:
- Returns a PNG QR image for the RoadTour scan URL.

Auth and role requirement:
- Public.

Input validation:
- Token regex check only.

DB objects touched:
- `roadtour_qr_codes` indirectly through `resolveRoadtourByToken()`

Response payload:
- PNG image response

Validation missing:
- No rate limiting
- No signed access pattern
- No visibility control around who can mass-fetch token images

Production safety assessment:
- Partial.

Reasons:
- Public QR image endpoint is understandable for distribution, but it should be treated as a public asset endpoint and protected accordingly with rate limiting and monitoring.

## `POST /api/roadtour/test-claim-alert`

File:
- `app/src/app/api/roadtour/test-claim-alert/route.ts`

Purpose:
- Sends a test RoadTour claim alert using current configuration.

Auth and role requirement:
- Requires authenticated user.
- Uses `isAdminUser()`.

Request payload:
- `status`, where only `success` is explicitly accepted; everything else is treated as `failed`

DB objects touched:
- `users`
- `roadtour_campaigns`
- `roadtour_claim_notification_logs` through `sendRoadtourClaimNotifications()`
- `roadtour_settings`
- `notification_provider_configs`

Validation present:
- auth check
- admin check
- requires at least one campaign in the org

Validation missing:
- No request-schema validator
- No rate limiting
- No explicit environment guard for test sends

Production safety assessment:
- Partial.

Reasons:
- Good as an internal admin tool.
- Should ideally log more explicit audit context for who initiated the test and why.

## Server-side helper functions

## `app/src/lib/roadtour/server.ts`

Functions found:
- `validateRoadtourToken()`
- `resolveRoadTourByFriendlyPath()`
- `resolveRoadtourByToken()`
- `buildRoadtourContextFromValidation()`

Purpose:
- Wraps production DB lookup and RPC behavior for server-rendered scan routes and friendly URL resolution.

Important observations:
- `validateRoadtourToken()` calls the production `validate_roadtour_qr_token()` function through the admin client.
- `validate_roadtour_qr_token()` increments `roadtour_qr_codes.usage_count` on every validation call, which means page loads inflate QR usage analytics.

Production safety:
- Partial. Good for server rendering, but the underlying DB function has analytics side effects.

## `app/src/lib/roadtour/notifications.ts`

Main function:
- `sendRoadtourClaimNotifications()`

Purpose:
- Builds RoadTour claim alert messages, resolves recipients, sends via the shared WhatsApp gateway helper, and inserts `roadtour_claim_notification_logs` rows.

Important observations:
- For `hq_org` mode it resolves recipients from `users` in the org and then filters by role.
- It normalizes phone numbers to E164 before send/log insert.
- It writes logs server-side, which is stronger than the client-side QR delivery logging pattern.

Production safety:
- Partial. Better than client-side logging, but still depends on surrounding route hardening and on org/user role correctness.

## `app/src/lib/roadtour/geolocation.ts`

Main functions:
- `normalizeRoadtourGeolocationInput()`
- `reverseGeocodeRoadtourLocation()`
- `getRoadtourLocationStatus()`
- `getRoadtourLocationError()`
- `getRoadtourGeoLabel()`

Purpose:
- Normalizes browser GPS payloads and resolves readable GeoLoc labels using Nominatim.

Important observations:
- The implementation is thoughtful and handles fallback states well.
- It uses public Nominatim without caching or a private provider abstraction.

Production safety:
- Partial.

Reason:
- Correctness is acceptable for low volume.
- Operational readiness under burst load is questionable.

## Direct client-side Supabase writes

These are important because they are not hidden behind server routes or server actions. They depend on the browser client plus RLS for enforcement.

| File | Observed writes | DB objects touched | Why this matters |
| --- | --- | --- | --- |
| `app/src/modules/roadtour/components/RoadtourCampaignsView.tsx` | create/update campaign, upsert/deactivate manager assignments, auto-create QR rows, revoke QR rows | `roadtour_campaigns`, `roadtour_campaign_managers`, `roadtour_qr_codes`, `roadtour_settings` | Business-critical mutations happen from the client. This is only safe if RLS is strict and org-scoped. |
| `app/src/modules/roadtour/components/RoadtourSurveyBuilderView.tsx` | create/update/delete templates and template fields, reorder fields | `roadtour_survey_templates`, `roadtour_survey_template_fields` | Template governance and publish safety rely on RLS alone. |
| `app/src/modules/roadtour/components/RoadtourSettingsView.tsx` | insert/update settings row | `roadtour_settings` | Admin configuration happens directly from the browser. |
| `app/src/components/engagement/catalog/RoadtourRewardSettings.tsx` | insert/update settings row again from a second screen | `roadtour_settings` | Same table is written from two separate admin surfaces. |
| `app/src/modules/roadtour/components/RoadtourQrManagementView.tsx` | revoke QR rows and insert QR delivery logs after send | `roadtour_qr_codes`, `roadtour_qr_delivery_logs` | Delivery logging can be forged or lost because the browser performs the insert after the route call. |

## Missing or weak server-only boundaries

Areas that should ideally move server-side:
- campaign creation and activation
- manager assignment
- automatic QR generation
- QR revocation
- settings writes
- QR delivery log creation after gateway send
- survey response persistence mapping

Reason:
- these are business-critical writes and should not depend solely on client filtering plus RLS.

## Missing role checks or authorization mismatches

Observed mismatches:
- `/roadtour` page shell only checks authentication and organization in `app/src/app/roadtour/_lib.ts`.
- Admin APIs use `isAdminUser()` with one admin vocabulary.
- Production RoadTour RLS uses a different hardcoded role-code vocabulary.
- No org-scoping is present in RoadTour policy expressions.

Operational effect:
- UI reachability, API authorization, and RLS authorization are not one coherent model.

## Anon-key versus server-key patterns

Observed patterns:
- Public scan pages and server helpers use server-side access where needed.
- Admin dashboard views use browser Supabase client access and rely on RLS.
- `claim-reward` is public but uses service-role server DB access.

Assessment:
- The design is mixed.
- This is acceptable only when server-side routes are narrow and client-side RLS is strong.
- That condition is not fully met today because RoadTour RLS is role-based but not org-scoped.

## Missing validation and anti-abuse controls

Not found on RoadTour routes:
- Zod or equivalent request-schema validation
- request-size guards
- rate limiting
- replay protection or explicit idempotency keys for public claim requests
- anti-bot or anti-scripting guard for repeated QR validation/image fetches

## API/server assessment conclusion

The RoadTour server surface is real and already does meaningful work. The main concern is not absence of backend logic. The main concern is that the logic boundary is in the wrong places:
- too much admin mutation still happens directly from browser Supabase clients,
- the public claim route is too powerful for its current hardening level,
- and configuration / survey behavior is not aligned cleanly between admin UI, live code, and production schema.