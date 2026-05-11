# 02. DB Schema Inventory

Source used for this document:
- `supabase/schemas/current_schema.sql`, refreshed from the self-hosted staging Supabase database on 2026-05-12 after the RoadTour Event sync work
- Cross-check against RoadTour migrations in `supabase/migrations`

This document treats the refreshed production schema snapshot as the primary source of truth.

## Object summary

### RoadTour tables found in production

- `roadtour_settings`
- `roadtour_campaigns`
- `roadtour_campaign_managers`
- `roadtour_qr_codes`
- `roadtour_qr_delivery_logs`
- `roadtour_scan_events`
- `roadtour_official_visits`
- `roadtour_survey_templates`
- `roadtour_survey_template_fields`
- `roadtour_survey_responses`
- `roadtour_survey_response_items`
- `roadtour_claim_notification_logs`

### RoadTour functions found in production

- `validate_roadtour_qr_token(text)`
- `record_roadtour_reward(uuid, uuid, uuid, uuid, uuid, uuid, integer, uuid, uuid, text, text)`
- `slugify_roadtour_segment(text)`
- `sync_roadtour_qr_route_fields()`

### RoadTour triggers found in production

- `trg_roadtour_qr_route_fields` on `roadtour_qr_codes`
- `trg_roadtour_campaigns_updated_at`
- `trg_roadtour_official_visits_updated_at`
- `trg_roadtour_qr_codes_updated_at`
- `trg_roadtour_settings_updated_at`
- `trg_roadtour_survey_responses_updated_at`
- `trg_roadtour_survey_template_fields_updated_at`
- `trg_roadtour_survey_templates_updated_at`
- `roadtour_scan_events_phone_normalization_trg`
- `roadtour_claim_notification_logs_phone_normalization_trg`

### RoadTour views found in production

No RoadTour-specific views were found in the refreshed production schema snapshot.

Important generic dependencies used by RoadTour code or functions:
- `v_consumer_points_balance`
- `points_transactions`
- `users`
- `organizations`

### RLS and policy summary

Production schema contains explicit RLS enablement and policies for:
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

No RoadTour RLS policy was found in production for:
- `roadtour_claim_notification_logs`

### Seed and demo data

What is visible from schema-only introspection:
- No production data rows were inspected.
- No seed rows are visible in `current_schema.sql` because this is schema-only.
- Migrations indicate an initial default RoadTour survey template may be inserted when none exists, but that is migration logic, not confirmed production data.

## Table inventory

## `roadtour_settings`

Business purpose:
- Stores org-level defaults and switches for RoadTour: enablement, reward mode, QR behavior, duplicate rules, login/shop/geolocation requirements, and claim-alert WhatsApp configuration.

How it connects to the flow:
- `validate_roadtour_qr_token()` reads it for `require_login`, `require_shop_context`, `require_geolocation`, and `duplicate_rule_reward`.
- Admin screens `RoadtourSettingsView` and `RoadtourRewardSettings` both write to this table.

Columns:

| Column | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | yes | `gen_random_uuid()` | PK |
| `org_id` | `uuid` | yes | none | FK to `organizations.id` |
| `is_enabled` | `boolean` | yes | `true` | Module toggle |
| `default_points` | `integer` | yes | `20` | Check `> 0` |
| `reward_mode` | `text` | yes | `survey_submit` | Check `direct_scan` or `survey_submit` |
| `survey_template_id` | `uuid` | no | none | FK to `roadtour_survey_templates.id` |
| `qr_mode` | `text` | yes | `persistent` | Check `persistent`, `time_limited`, `one_time` |
| `duplicate_rule_reward` | `text` | yes | `one_per_user_per_campaign` | Duplicate reward rule |
| `official_visit_rule` | `text` | yes | `one_per_shop_per_am_per_day` | Official visit rule |
| `require_login` | `boolean` | yes | `true` | Public claim gate |
| `require_shop_context` | `boolean` | yes | `true` | Public claim gate |
| `require_geolocation` | `boolean` | yes | `false` | Public claim gate |
| `qr_expiry_hours` | `integer` | no | none | Used with `time_limited` QR mode |
| `point_value_rm_snapshot` | `numeric(10,4)` | no | none | Cost estimation snapshot |
| `whatsapp_send_enabled` | `boolean` | yes | `true` | QR-send enable flag |
| `is_active` | `boolean` | yes | `true` | Soft-active flag |
| `created_at` | `timestamptz` | yes | `now()` | Audit timestamp |
| `updated_at` | `timestamptz` | yes | `now()` | Audit timestamp |
| `created_by` | `uuid` | no | none | Actor reference, but no FK in RoadTour section was shown |
| `updated_by` | `uuid` | no | none | Actor reference, but no FK in RoadTour section was shown |
| `claim_whatsapp_enabled` | `boolean` | yes | `false` | Claim alert enable flag |
| `claim_whatsapp_recipient_mode` | `text` | yes | `manual` | Check `manual` or `hq_org` |
| `claim_whatsapp_manual_numbers` | `text[]` | yes | empty array | Manual recipient list |
| `claim_whatsapp_success_template` | `text` | no | none | Success alert message template |
| `claim_whatsapp_failure_template` | `text` | no | none | Failure or duplicate alert template |

Keys, constraints, indexes, triggers, policies:
- PK: `roadtour_settings_pkey (id)`
- Unique: `uq_roadtour_settings_org (org_id)`
- FK: `roadtour_settings_org_id_fkey -> organizations.id ON DELETE CASCADE`
- FK: `fk_roadtour_settings_survey_template -> roadtour_survey_templates.id ON DELETE SET NULL`
- Checks: `default_points > 0`, allowed reward modes, QR modes, duplicate rule values, official visit rule values, claim alert recipient modes
- Index: `idx_roadtour_settings_org (org_id)`
- Trigger: `trg_roadtour_settings_updated_at`
- RLS: `roadtour_settings_admin_select`, `roadtour_settings_admin_manage`

Assessment:
- Good: the table captures most org-level operational toggles in one row.
- Weakness: live claim behavior uses campaign-level `default_points`, `reward_mode`, and `survey_template_id`, so these settings are not the effective single source of truth.
- Missing for reporting: no explicit `published_at`, `effective_from`, or change-history table for settings drift.
- Auditability: moderate only. Timestamps exist, but no guaranteed FK or audit-history table for who changed what and why.

## `roadtour_campaigns`

Business purpose:
- Stores campaign definition, lifecycle status, date range, reward mode, QR mode, region scope, and basic notes.

How it connects to the flow:
- Activation controls whether `validate_roadtour_qr_token()` returns the QR as valid.
- Admin campaign UI creates and updates these rows directly from the client.
- QR generation and analytics are all campaign-centered.

Columns:

| Column | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | yes | `gen_random_uuid()` | PK |
| `org_id` | `uuid` | yes | none | FK to `organizations.id` |
| `name` | `text` | yes | none | Campaign name |
| `description` | `text` | no | none | Free-text description |
| `start_date` | `date` | yes | none | Start window |
| `end_date` | `date` | yes | none | End window |
| `status` | `text` | yes | `draft` | Check `draft`, `active`, `paused`, `completed`, `archived` |
| `region_scope` | `jsonb` | no | none | Region list, currently the only target-scoping field |
| `default_points` | `integer` | yes | `20` | Check `> 0` |
| `reward_mode` | `text` | yes | `survey_submit` | Check `direct_scan` or `survey_submit` |
| `survey_template_id` | `uuid` | no | none | FK to `roadtour_survey_templates.id` |
| `qr_mode` | `text` | yes | `persistent` | Check `persistent`, `time_limited`, `one_time` |
| `notes` | `text` | no | none | Free-text notes |
| `created_at` | `timestamptz` | yes | `now()` | Audit timestamp |
| `updated_at` | `timestamptz` | yes | `now()` | Audit timestamp |
| `created_by` | `uuid` | no | none | Actor snapshot only |
| `updated_by` | `uuid` | no | none | Actor snapshot only |

Keys, constraints, indexes, triggers, policies:
- PK: `roadtour_campaigns_pkey (id)`
- FK: `roadtour_campaigns_org_id_fkey -> organizations.id ON DELETE CASCADE`
- FK: `fk_roadtour_campaigns_survey_template -> roadtour_survey_templates.id ON DELETE SET NULL`
- Checks: allowed statuses, reward modes, QR modes, `default_points > 0`
- Indexes: `idx_roadtour_campaigns_org_status`, `idx_roadtour_campaigns_dates`
- Trigger: `trg_roadtour_campaigns_updated_at`
- RLS: `roadtour_campaigns_admin_select`, `roadtour_campaigns_admin_manage`

Assessment:
- Good: campaign lifecycle status, date range, and reward mode are represented.
- Missing: no campaign approval state, no `activated_at`, `paused_at`, `completed_at`, or `archived_at`, no explicit target-shop or target-user table, and no broadcast/distribution fields.
- Production reporting readiness: partial. High-level status reporting is possible, but target coverage and lifecycle history reporting are not.
- Auditability: limited. Created/updated metadata exists, but there is no status-history table or structured change log.

## `roadtour_campaign_managers`

Business purpose:
- Junction table linking campaigns to assigned account managers or references.

How it connects to the flow:
- QR generation reads active assignments to create `roadtour_qr_codes` records.
- Campaign UI and manager dialogs upsert or deactivate these rows directly from the client.

Columns:

| Column | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | yes | `gen_random_uuid()` | PK |
| `campaign_id` | `uuid` | yes | none | FK to `roadtour_campaigns.id` |
| `user_id` | `uuid` | yes | none | FK to `users.id` |
| `assigned_at` | `timestamptz` | yes | `now()` | Assignment timestamp |
| `assigned_by` | `uuid` | no | none | Actor snapshot only |
| `is_active` | `boolean` | yes | `true` | Soft-active flag |

Keys, constraints, indexes, triggers, policies:
- PK: `roadtour_campaign_managers_pkey (id)`
- Unique: `uq_roadtour_campaign_manager (campaign_id, user_id)`
- FK: `roadtour_campaign_managers_campaign_id_fkey -> roadtour_campaigns.id ON DELETE CASCADE`
- FK: `roadtour_campaign_managers_user_id_fkey -> users.id ON DELETE CASCADE`
- Indexes: `idx_roadtour_campaign_managers_campaign`, `idx_roadtour_campaign_managers_user`
- No updated-at trigger found
- RLS: `roadtour_campaign_managers_admin_select`, `roadtour_campaign_managers_admin_manage`, `roadtour_campaign_managers_self_select`

Assessment:
- Good: captures active/inactive assignment state with a unique campaign/user link.
- Missing: no `removed_at`, `removed_by`, `role_snapshot`, `assignment_reason`, or org snapshot. There is also no explicit constraint that the assigned user belongs to the same org as the campaign.
- Production reporting readiness: weak for assignment history because deactivation is only a boolean flip.
- Auditability: weak. Historical assignment churn is not fully reconstructable.

## `roadtour_qr_codes`

Business purpose:
- Stores campaign QR tokens, friendly URL routing fields, lifecycle status, expiry, and usage counters.

How it connects to the flow:
- Public scan routes resolve from these rows.
- Friendly RoadTour URLs are generated from trigger-driven route fields.
- QR management UI reads and revokes these rows.

Columns:

| Column | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | yes | `gen_random_uuid()` | PK |
| `campaign_id` | `uuid` | yes | none | FK to `roadtour_campaigns.id` |
| `account_manager_user_id` | `uuid` | yes | none | FK to `users.id` |
| `shop_id` | `uuid` | no | none | Optional shop scoping |
| `qr_code` | `text` | no | none | Stored QR blob or data URL; currently unused by most UI paths |
| `token` | `text` | yes | generated base64url bytes | Main opaque token |
| `status` | `text` | yes | `active` | Check `active`, `revoked`, `expired` |
| `qr_mode` | `text` | yes | `persistent` | Check `persistent`, `time_limited`, `one_time` |
| `expires_at` | `timestamptz` | no | none | Time-limited QR support |
| `usage_count` | `integer` | yes | `0` | Incremented during validation |
| `last_used_at` | `timestamptz` | no | none | Last validation time |
| `created_at` | `timestamptz` | yes | `now()` | Audit timestamp |
| `updated_at` | `timestamptz` | yes | `now()` | Audit timestamp |
| `route_year` | `integer` | no | none | Friendly path segment |
| `campaign_slug` | `text` | no | none | Friendly path segment |
| `reference_slug` | `text` | no | none | Friendly path segment |
| `short_code` | `text` | no | none | Friendly path short code |
| `canonical_path` | `text` | no | none | Canonical RoadTour URL path |

Keys, constraints, indexes, triggers, policies:
- PK: `roadtour_qr_codes_pkey (id)`
- Unique constraint: `roadtour_qr_codes_token_key (token)`
- Unique index: `idx_roadtour_qr_codes_token (token)`
- Unique index: `uq_roadtour_qr_am_campaign_active (campaign_id, account_manager_user_id) WHERE status = 'active' AND shop_id IS NULL`
- Unique index: `uq_roadtour_qr_codes_canonical_path (canonical_path) WHERE canonical_path IS NOT NULL`
- Unique index: `uq_roadtour_qr_codes_short_code (short_code) WHERE short_code IS NOT NULL`
- FK: `campaign_id -> roadtour_campaigns.id ON DELETE CASCADE`
- FK: `account_manager_user_id -> users.id ON DELETE CASCADE`
- FK: `shop_id -> organizations.id ON DELETE SET NULL`
- Checks: allowed statuses and QR modes
- Indexes: `idx_roadtour_qr_codes_campaign`, `idx_roadtour_qr_codes_am`
- Triggers: `trg_roadtour_qr_codes_updated_at`, `trg_roadtour_qr_route_fields`
- RLS: `roadtour_qr_codes_admin_select`, `roadtour_qr_codes_admin_manage`

Assessment:
- Good: route fields and uniqueness support clean friendly URLs.
- Weakness: no batch identifier, no `generated_by`, no `revoked_by`, no revoke reason, no delivery-state columns, no print/export tracking, no dedicated audit table.
- Production reporting readiness: limited for distribution and lifecycle analytics.
- Auditability: moderate for token state, weak for operator actions.

## `roadtour_qr_delivery_logs`

Business purpose:
- Stores QR delivery attempts and provider delivery status for outbound QR sends.

How it connects to the flow:
- QR management page inserts rows after a successful `send-qr-whatsapp` API call.
- WhatsApp Monitoring page reads this table.

Columns:

| Column | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | yes | `gen_random_uuid()` | PK |
| `campaign_id` | `uuid` | yes | none | FK to `roadtour_campaigns.id` |
| `qr_code_id` | `uuid` | yes | none | FK to `roadtour_qr_codes.id` |
| `account_manager_user_id` | `uuid` | yes | none | FK to `users.id` |
| `phone_number` | `text` | yes | none | No E164 check found in production schema |
| `channel` | `text` | yes | `whatsapp` | Channel label |
| `send_status` | `text` | yes | `pending` | Check `pending`, `sent`, `delivered`, `failed` |
| `provider_message_id` | `text` | no | none | Provider message reference |
| `error_message` | `text` | no | none | Failure text |
| `sent_at` | `timestamptz` | no | none | Sent timestamp |
| `delivered_at` | `timestamptz` | no | none | Delivery timestamp |
| `created_at` | `timestamptz` | yes | `now()` | Audit timestamp |

Keys, constraints, indexes, triggers, policies:
- PK: `roadtour_qr_delivery_logs_pkey (id)`
- FK: `campaign_id -> roadtour_campaigns.id ON DELETE CASCADE`
- FK: `qr_code_id -> roadtour_qr_codes.id ON DELETE CASCADE`
- FK: `account_manager_user_id -> users.id ON DELETE CASCADE`
- Check: `send_status` allowed values
- Indexes: `idx_roadtour_delivery_logs_campaign`, `idx_roadtour_delivery_logs_qr`
- No updated-at or phone-normalization trigger found
- RLS: `roadtour_qr_delivery_logs_admin_select`, `roadtour_qr_delivery_logs_admin_manage`

Assessment:
- Good: enough to display a simple send-status table.
- Weakness: no org_id, no normalized-phone guarantee, no request payload snapshot, no retry count, no webhook payload, and no actor columns.
- Production reporting readiness: partial for basic delivery counts, weak for support and provider troubleshooting.
- Auditability: weak because the table is populated from client code after the send route completes.

## `roadtour_scan_events`

Business purpose:
- Records RoadTour scan attempts and reward-related scan telemetry.

How it connects to the flow:
- `claim-reward` inserts here first.
- `record_roadtour_reward()` updates the row to mark reward success and transaction id.
- Visits, analytics, and claim notifications read from this table.

Columns:

| Column | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | yes | `gen_random_uuid()` | PK |
| `campaign_id` | `uuid` | yes | none | FK to `roadtour_campaigns.id` |
| `qr_code_id` | `uuid` | yes | none | FK to `roadtour_qr_codes.id` |
| `account_manager_user_id` | `uuid` | yes | none | FK to `users.id` |
| `scanned_by_user_id` | `uuid` | no | none | FK to `users.id` |
| `shop_id` | `uuid` | no | none | FK to `organizations.id` |
| `scan_status` | `text` | yes | `opened` | Check `success`, `duplicate`, `invalid`, `expired`, `rejected`, `opened` |
| `points_awarded` | `integer` | yes | `0` | Reward points |
| `reward_transaction_id` | `uuid` | no | none | FK to `points_transactions.id` |
| `scan_time` | `timestamptz` | yes | `now()` | Main event timestamp |
| `geolocation` | `jsonb` | no | none | Raw geolocation payload |
| `metadata` | `jsonb` | no | none | Misc payload |
| `created_at` | `timestamptz` | yes | `now()` | Audit timestamp |
| `consumer_phone` | `text` | no | none | Phone snapshot; normalized by trigger |
| `geo_label` | `text` | no | none | Readable location label |
| `geo_city` | `text` | no | none | Reverse-geocoded city |
| `geo_state` | `text` | no | none | Reverse-geocoded state |
| `geo_country` | `text` | no | none | Reverse-geocoded country |
| `geo_full_address` | `text` | no | none | Full address |
| `latitude` | `double precision` | no | none | Raw coordinate |
| `longitude` | `double precision` | no | none | Raw coordinate |
| `accuracy_m` | `double precision` | no | none | Accuracy meters |
| `geo_source` | `text` | no | none | Usually browser |
| `geo_payload` | `jsonb` | no | none | Captured geo payload |
| `location_status` | `text` | yes | `missing` | Check `resolved`, `captured`, `permission_denied`, `timeout`, `unavailable`, `error`, `missing` |
| `location_error` | `text` | no | none | Browser or reverse-geocode error |
| `location_captured_at` | `timestamptz` | no | none | Capture completion time |
| `geo_resolved_at` | `timestamptz` | no | none | Reverse-geocode completion time |

Keys, constraints, indexes, triggers, policies:
- PK: `roadtour_scan_events_pkey (id)`
- FKs: `campaign_id`, `qr_code_id`, `account_manager_user_id`, `scanned_by_user_id`, `shop_id`, `reward_transaction_id`
- Checks: allowed scan statuses, allowed location statuses
- Indexes: `idx_roadtour_scan_events_campaign`, `idx_roadtour_scan_events_qr`, `idx_roadtour_scan_events_user`, `idx_roadtour_scan_events_location_status`
- Trigger: `roadtour_scan_events_phone_normalization_trg`
- No updated-at trigger because the table has no `updated_at` column
- RLS: `roadtour_scan_events_admin_select`, `roadtour_scan_events_admin_manage`, `roadtour_scan_events_self_select`

Assessment:
- Good: this is the strongest RoadTour telemetry table in production and includes geolocation readiness fields.
- Weakness: no IP hash, user-agent, request-id, idempotency key, or explicit scan-source field. The code also increments QR `usage_count` during validation, so QR usage and scan-event counts are not a clean one-to-one signal.
- Production reporting readiness: moderate. Good enough for location and reward reporting, weak for abuse monitoring and forensic tracing.
- Auditability: moderate. Event rows are durable, but anti-abuse metadata is thin.

## `roadtour_official_visits`

Business purpose:
- Stores the normalized visit fact that a campaign/account-manager/shop combination produced an official visit on a given date.

How it connects to the flow:
- `record_roadtour_reward()` attempts to insert an official visit after successful reward processing.
- Visits screen and analytics depend heavily on this table.

Columns:

| Column | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | yes | `gen_random_uuid()` | PK |
| `campaign_id` | `uuid` | yes | none | FK to `roadtour_campaigns.id` |
| `account_manager_user_id` | `uuid` | yes | none | FK to `users.id` |
| `shop_id` | `uuid` | yes | none | FK to `organizations.id` |
| `official_scan_event_id` | `uuid` | no | none | FK to `roadtour_scan_events.id` |
| `official_survey_response_id` | `uuid` | no | none | FK to `roadtour_survey_responses.id` |
| `visit_date` | `date` | yes | `CURRENT_DATE` | Official visit date |
| `visit_status` | `text` | yes | `official` | Check `official`, `duplicate`, `manual`, `cancelled` |
| `notes` | `text` | no | none | Free-text notes |
| `created_at` | `timestamptz` | yes | `now()` | Audit timestamp |
| `updated_at` | `timestamptz` | yes | `now()` | Audit timestamp |

Keys, constraints, indexes, triggers, policies:
- PK: `roadtour_official_visits_pkey (id)`
- Unique: `uq_roadtour_official_visit (campaign_id, account_manager_user_id, shop_id, visit_date)`
- FKs: `campaign_id`, `account_manager_user_id`, `shop_id`, `official_scan_event_id`, `official_survey_response_id`
- Check: allowed `visit_status`
- Indexes: `idx_roadtour_official_visits_campaign`, `idx_roadtour_official_visits_am`
- Trigger: `trg_roadtour_official_visits_updated_at`
- RLS: `roadtour_official_visits_admin_select`, `roadtour_official_visits_admin_manage`

Assessment:
- Good: deduplicates official visit counting at the DB layer.
- Weakness: no check-in/out timestamps, duration, visit outcome, manual override actor, or GPS snapshot directly on the visit row.
- Production reporting readiness: partial. Useful for one-visit-per-day reporting, weak for field productivity and route-performance reporting.
- Auditability: limited. Notes are free text and not attributed to a specific editor.

## `roadtour_survey_templates`

Business purpose:
- Stores survey template headers.

How it connects to the flow:
- Builder UI reads and writes this table.
- Campaigns and settings may reference a template through `survey_template_id`.

Columns:

| Column | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | yes | `gen_random_uuid()` | PK |
| `org_id` | `uuid` | yes | none | FK to `organizations.id` |
| `name` | `text` | yes | none | Template name |
| `description` | `text` | no | none | Description |
| `is_active` | `boolean` | yes | `true` | Active flag |
| `created_at` | `timestamptz` | yes | `now()` | Audit timestamp |
| `updated_at` | `timestamptz` | yes | `now()` | Audit timestamp |
| `created_by` | `uuid` | no | none | Actor snapshot |
| `updated_by` | `uuid` | no | none | Actor snapshot |

Keys, constraints, indexes, triggers, policies:
- PK: `roadtour_survey_templates_pkey (id)`
- FK: `roadtour_survey_templates_org_id_fkey -> organizations.id ON DELETE CASCADE`
- Index: `idx_roadtour_survey_templates_org (org_id, is_active)`
- Trigger: `trg_roadtour_survey_templates_updated_at`
- RLS: `roadtour_survey_templates_admin_select`, `roadtour_survey_templates_admin_manage`, `roadtour_survey_templates_public_select`

Assessment:
- Good: simple and sufficient as a template header table.
- Weakness: no `version`, `published_at`, `archived_at`, or immutable publish model. The UI references `version`, but production schema does not have that column.
- Production reporting readiness: minimal. Template usage can be linked through `survey_template_id`, but template-version reporting is not possible.
- Auditability: weak to moderate.

## `roadtour_survey_template_fields`

Business purpose:
- Stores field definitions for each survey template.

How it connects to the flow:
- Builder UI and survey rendering both depend on these rows.
- Public claim survey rendering reads active template fields through public-select RLS.

Columns:

| Column | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | yes | `gen_random_uuid()` | PK |
| `template_id` | `uuid` | yes | none | FK to `roadtour_survey_templates.id` |
| `field_key` | `text` | yes | none | Logical key |
| `field_label` | `text` | yes | none | Display label |
| `field_type` | `text` | yes | none | Check includes `text`, `textarea`, `yes_no`, `single_select`, `multi_select`, `checkbox`, `radio`, `number`, `phone`, `photo` |
| `field_options` | `jsonb` | no | none | Options array payload |
| `is_required` | `boolean` | yes | `false` | Required flag |
| `sort_order` | `integer` | yes | `0` | Field ordering |
| `placeholder` | `text` | no | none | Placeholder text |
| `help_text` | `text` | no | none | Helper text |
| `created_at` | `timestamptz` | yes | `now()` | Audit timestamp |
| `updated_at` | `timestamptz` | yes | `now()` | Audit timestamp |

Keys, constraints, indexes, triggers, policies:
- PK: `roadtour_survey_template_fields_pkey (id)`
- FK: `roadtour_survey_template_fields_template_id_fkey -> roadtour_survey_templates.id ON DELETE CASCADE`
- Check: allowed `field_type` values
- Index: `idx_roadtour_survey_fields_template (template_id, sort_order)`
- Trigger: `trg_roadtour_survey_template_fields_updated_at`
- RLS: `roadtour_survey_template_fields_admin_select`, `roadtour_survey_template_fields_admin_manage`, `roadtour_survey_template_fields_public_select`

Assessment:
- Good: flexible enough for a survey-builder MVP.
- Weakness: no uniqueness constraint on `(template_id, field_key)`, so duplicate keys are technically possible. No field versioning or retire-at semantics.
- Production reporting readiness: partial. The response-items table snapshots labels and types, which helps, but template governance is weak.
- Auditability: moderate.

## `roadtour_survey_responses`

Business purpose:
- Stores one survey submission header per RoadTour claim attempt.

How it connects to the flow:
- `claim-reward` attempts to insert here when the campaign requires a survey.
- `record_roadtour_reward()` updates points and reward transaction linkage on the response row.
- Official visits may point to one survey response as the official survey for the visit.

Columns:

| Column | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | yes | `gen_random_uuid()` | PK |
| `campaign_id` | `uuid` | yes | none | FK to `roadtour_campaigns.id` |
| `qr_code_id` | `uuid` | yes | none | FK to `roadtour_qr_codes.id` |
| `account_manager_user_id` | `uuid` | yes | none | FK to `users.id` |
| `scanned_by_user_id` | `uuid` | yes | none | FK to `users.id` |
| `shop_id` | `uuid` | no | none | FK to `organizations.id` |
| `scan_event_id` | `uuid` | no | none | FK to `roadtour_scan_events.id` |
| `template_id` | `uuid` | yes | none | FK to `roadtour_survey_templates.id` |
| `response_status` | `text` | yes | `submitted` | Check `submitted`, `rejected`, `draft` |
| `submitted_at` | `timestamptz` | no | none | Submission timestamp |
| `points_awarded` | `integer` | yes | `0` | Reward points |
| `reward_transaction_id` | `uuid` | no | none | FK to `points_transactions.id` |
| `created_at` | `timestamptz` | yes | `now()` | Audit timestamp |
| `updated_at` | `timestamptz` | yes | `now()` | Audit timestamp |

Keys, constraints, indexes, triggers, policies:
- PK: `roadtour_survey_responses_pkey (id)`
- FKs: `campaign_id`, `qr_code_id`, `account_manager_user_id`, `scanned_by_user_id`, `shop_id`, `scan_event_id`, `template_id`, `reward_transaction_id`
- Check: allowed `response_status`
- Indexes: `idx_roadtour_survey_responses_campaign`, `idx_roadtour_survey_responses_user`
- Trigger: `trg_roadtour_survey_responses_updated_at`
- RLS: `roadtour_survey_responses_admin_select`, `roadtour_survey_responses_admin_manage`, `roadtour_survey_responses_self_insert`, `roadtour_survey_responses_self_select`

Assessment:
- Good: captures the core survey-submission grain with links back to campaign, QR, scanner, and reward.
- Weakness: current live API does not insert the required columns that production schema expects. There is also no template version snapshot, no consumer phone snapshot, and no org_id for easier reporting.
- Production reporting readiness: partial in schema design, poor in current app implementation.
- Auditability: moderate if populated correctly, but currently at risk because the app payload is mismatched.

## `roadtour_survey_response_items`

Business purpose:
- Stores field-level answers for each survey response.

How it connects to the flow:
- `claim-reward` should insert one row per answered field.
- Survey review and downstream analytics depend on this table.

Columns:

| Column | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | yes | `gen_random_uuid()` | PK |
| `response_id` | `uuid` | yes | none | FK to `roadtour_survey_responses.id` |
| `field_key` | `text` | yes | none | Template field key |
| `field_label_snapshot` | `text` | no | none | Snapshot label |
| `field_type_snapshot` | `text` | no | none | Snapshot type |
| `answer_text` | `text` | no | none | Text answer |
| `answer_json` | `jsonb` | no | none | Structured answer |
| `answer_number` | `numeric` | no | none | Numeric answer |
| `media_url` | `text` | no | none | Photo/media URL |
| `created_at` | `timestamptz` | yes | `now()` | Audit timestamp |

Keys, constraints, indexes, triggers, policies:
- PK: `roadtour_survey_response_items_pkey (id)`
- FK: `roadtour_survey_response_items_response_id_fkey -> roadtour_survey_responses.id ON DELETE CASCADE`
- Index: `idx_roadtour_survey_items_response (response_id)`
- No update trigger found
- RLS: `roadtour_survey_response_items_admin_select`, `roadtour_survey_response_items_admin_manage`, `roadtour_survey_response_items_self_insert`, `roadtour_survey_response_items_self_select`

Assessment:
- Good: schema is reporting-friendly because it preserves field snapshots and supports text, JSON, numeric, and media answer shapes.
- Weakness: the live API currently inserts a non-existent `value` column instead of mapping into `answer_text`, `answer_json`, or `answer_number`.
- Production reporting readiness: good in schema design, poor in current implementation.
- Auditability: good if populated correctly.

## `roadtour_claim_notification_logs`

Business purpose:
- Stores HQ or manual-recipient claim alert notifications for success, failure, duplicate, and test sends.

How it connects to the flow:
- `sendRoadtourClaimNotifications()` writes here.
- Visits screen reads this table for latest claim-alert status.

Columns:

| Column | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | yes | `gen_random_uuid()` | PK |
| `scan_event_id` | `uuid` | no | none | FK to `roadtour_scan_events.id` |
| `campaign_id` | `uuid` | yes | none | FK to `roadtour_campaigns.id` |
| `qr_code_id` | `uuid` | no | none | FK to `roadtour_qr_codes.id` |
| `account_manager_user_id` | `uuid` | no | none | FK to `users.id` |
| `phone_number` | `text` | yes | none | E164 constrained and normalized by trigger |
| `recipient_label` | `text` | no | none | Human-readable recipient |
| `notification_type` | `text` | yes | `failed` | Check `success`, `failed`, `duplicate`, `test` |
| `send_status` | `text` | yes | `pending` | Check `pending`, `sent`, `delivered`, `failed` |
| `provider_message_id` | `text` | no | none | Provider message ref |
| `template_used` | `text` | no | none | Template text used at send time |
| `rendered_message` | `text` | no | none | Rendered final text |
| `error_message` | `text` | no | none | Failure message |
| `metadata` | `jsonb` | no | none | Additional payload |
| `sent_at` | `timestamptz` | no | none | Send timestamp |
| `created_at` | `timestamptz` | yes | `now()` | Audit timestamp |

Keys, constraints, indexes, triggers, policies:
- PK: `roadtour_claim_notification_logs_pkey (id)`
- FKs: `scan_event_id`, `campaign_id`, `qr_code_id`, `account_manager_user_id`
- Checks: `notification_type`, `send_status`, `phone_number` E164 check
- Indexes: `idx_roadtour_claim_notification_logs_campaign`, `idx_roadtour_claim_notification_logs_scan_event`
- Trigger: `roadtour_claim_notification_logs_phone_normalization_trg`
- No RLS policy found in the refreshed production schema snapshot

Assessment:
- Good: richer than QR delivery logs because it stores the rendered message and template used.
- Weakness: no `org_id`, no `delivered_at`, no retry count, no update trigger, and no explicit RLS policy found in production.
- Production reporting readiness: partial. Useful for alert troubleshooting, weak for tenant-safe admin reporting unless access is constrained elsewhere.
- Auditability: moderate.

## Cross-object observations

### Campaign lifecycle and status

Present:
- `roadtour_campaigns.status`
- `roadtour_campaigns.start_date`
- `roadtour_campaigns.end_date`

Missing or weak:
- no activation timestamp
- no status transition history
- no approval or publish workflow
- no closeout summary object

Assessment:
- Enough for a basic MVP campaign list.
- Not enough for production operations that need auditability and close-out reporting.

### Assigned account manager / field staff

Present:
- `roadtour_campaign_managers` links campaign to `users.id`
- `roadtour_qr_codes.account_manager_user_id`
- `roadtour_official_visits.account_manager_user_id`

Missing or weak:
- no role snapshot on assignment
- no org snapshot on assignment
- no removed-by or removed-at
- no routing, territory, or visit-plan model

### Shop / customer target list

Present:
- `roadtour_campaigns.region_scope` as JSONB
- optional `roadtour_qr_codes.shop_id`
- optional `roadtour_scan_events.shop_id`

Missing:
- no explicit campaign target table for shops or customers
- no planned-vs-visited model
- no denominator for coverage reporting

This is one of the largest reporting gaps in the schema.

### QR generation and batch tracking

Present:
- `roadtour_qr_codes` stores token, friendly URL fields, mode, expiry, and lifecycle status
- uniqueness protects active one-QR-per-manager-per-campaign for unscoped QR rows

Missing:
- no batch table
- no generated-by or revoked-by fields
- no distribution-channel history
- no print/export tracking

### QR scan and activation tracking

Present:
- `roadtour_scan_events`
- `roadtour_qr_codes.usage_count` and `last_used_at`

Weakness:
- `usage_count` increments during token validation, not only during successful claim or survey completion, so it is not a clean activation metric.

### Visit check-in / check-out and GPS

Present:
- `roadtour_official_visits` with one-visit-per-shop-per-AM-per-day uniqueness
- `roadtour_scan_events` with GPS and reverse-geocode fields

Missing:
- no check-in timestamp
- no check-out timestamp
- no visit duration
- no visit outcome taxonomy
- no explicit route-planning or attendance model

### Survey questions and answers

Present:
- `roadtour_survey_templates`
- `roadtour_survey_template_fields`
- `roadtour_survey_responses`
- `roadtour_survey_response_items`

Weakness:
- good schema design at the item level, but live app writes are currently mismatched with the production schema.

### WhatsApp delivery status

Present:
- `roadtour_qr_delivery_logs`
- `roadtour_claim_notification_logs`

Weakness:
- monitoring UI only covers QR delivery logs, not claim alert logs.
- QR delivery logs are structurally thinner than claim alert logs.

### Analytics and reporting data

Present:
- enough base tables exist to compute campaign, manager, visit, survey, and scan summaries.

Missing:
- no RoadTour-specific reporting view or materialized aggregate
- no campaign target denominator table
- no lifecycle history
- no batch-level distribution or conversion facts

### Created by / updated by / timestamps

Present:
- many core tables carry `created_at` and `updated_at`
- some tables carry `created_by` and `updated_by`

Weak or missing:
- no actor fields on `roadtour_qr_codes`
- no actor fields on `roadtour_qr_delivery_logs`
- no actor fields on `roadtour_claim_notification_logs`
- no updated_at on `roadtour_scan_events`
- no removal audit on assignment links

### Tenant / org scoping

Present:
- org linkage exists directly on `roadtour_settings`, `roadtour_campaigns`, and `roadtour_survey_templates`
- other RoadTour tables derive org through the campaign

Weakness:
- production RLS policies do not enforce org matching in their policy expressions.

### Audit trail and archival strategy

Present:
- timestamps and status fields
- official visit uniqueness
- some actor columns

Missing:
- no RoadTour event audit table
- no campaign status history table
- no explicit archival table or retention model for logs
- no soft-delete strategy beyond status/is_active fields on some tables

## Schema conclusion

The production RoadTour schema is substantial and far beyond placeholder level. It can already support:
- campaign definitions,
- assignment links,
- QR lifecycle rows,
- scan-event telemetry,
- official visit facts,
- survey templates and responses,
- QR delivery logs,
- claim-alert logs.

The biggest schema-level weaknesses are not total absence of tables. They are:
- missing org-safe policy design,
- missing target-list and lifecycle-history objects,
- weak auditability around QR issuance and assignment churn,
- and live app/schema mismatches around survey response persistence.

For production reporting, the schema is strong enough to start with campaign, QR, scan, visit, and notification facts, but not strong enough yet for reliable operational reporting from day one without additional schema and app alignment work.