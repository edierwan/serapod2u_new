# RoadTour DB Discovery

Date: 2026-05-12  
Source DB: staging (`supabase` database on `serapod-stg-db`)

## 1. RoadTour tables (public schema)

| Table | Staging rows (2026-05-12) | Master data? | Notes |
| --- | --- | --- | --- |
| `roadtour_settings` | 1 | yes | org-level config; preserve |
| `roadtour_survey_templates` | 2 | yes | survey master; preserve |
| `roadtour_survey_template_fields` | 7 | yes | survey master; preserve |
| `roadtour_campaigns` | 1 | no | transactional |
| `roadtour_campaign_managers` | 1 | no | transactional |
| `roadtour_qr_codes` | 1 | no | transactional |
| `roadtour_qr_delivery_logs` | 2 | no | transactional |
| `roadtour_scan_events` | 4 | no | transactional |
| `roadtour_official_visits` | 2 | no | transactional |
| `roadtour_survey_responses` | 4 | no | transactional |
| `roadtour_survey_response_items` | 22 | no | transactional |
| `roadtour_claim_notification_logs` | 4 | no | transactional |

## 2. Shared tables touched by RoadTour

### `points_transactions`

- `transaction_type` value is `roadtour_survey` (or similar `roadtour_*`).
- Linked back through `roadtour_scan_events.reward_transaction_id` and
  `roadtour_survey_responses.reward_transaction_id`.
- Staging counts (2026-05-12):
  - rows linked via scan events: 3
  - rows linked via survey responses: 3
  - rows with `transaction_type ILIKE 'roadtour%'`: 24
  - rows with `description ILIKE '%roadtour%'`: 24
- Cleanup strategy: delete by `transaction_type ILIKE 'roadtour%'` so orphan
  rows from earlier test runs also get removed. Other modules use distinct
  `transaction_type` values, so this is safe.

### `consumer_qr_scans`

- Belongs to the normal consumer journey; references public `qr_codes` (not
  `roadtour_qr_codes`).
- No RoadTour data lives here. **Skipped.**

### `consumer_activations`, `consumer_feedback`, `shop_points_ledger`, `redeem_gift_transactions`

- Not used by RoadTour code paths. **Skipped.**

## 3. RoadTour foreign keys (child → parent, key ones)

```
roadtour_qr_codes.campaign_id        -> roadtour_campaigns(id)  ON DELETE CASCADE
roadtour_campaign_managers.campaign_id -> roadtour_campaigns(id) ON DELETE CASCADE
roadtour_qr_delivery_logs.campaign_id -> roadtour_campaigns(id) ON DELETE CASCADE
roadtour_qr_delivery_logs.qr_code_id  -> roadtour_qr_codes(id)  ON DELETE CASCADE
roadtour_scan_events.campaign_id      -> roadtour_campaigns(id) (no cascade)
roadtour_scan_events.qr_code_id       -> roadtour_qr_codes(id)
roadtour_scan_events.reward_transaction_id -> points_transactions(id)
roadtour_official_visits.campaign_id  -> roadtour_campaigns(id)
roadtour_official_visits.official_scan_event_id  -> roadtour_scan_events(id)
roadtour_official_visits.official_survey_response_id -> roadtour_survey_responses(id)
roadtour_survey_responses.campaign_id  -> roadtour_campaigns(id)
roadtour_survey_responses.scan_event_id -> roadtour_scan_events(id)
roadtour_survey_responses.reward_transaction_id -> points_transactions(id)
roadtour_survey_response_items.response_id -> roadtour_survey_responses(id) CASCADE
roadtour_claim_notification_logs.scan_event_id -> roadtour_scan_events(id)
roadtour_claim_notification_logs.campaign_id   -> roadtour_campaigns(id)
roadtour_claim_notification_logs.qr_code_id    -> roadtour_qr_codes(id)
```

## 4. Safe child-to-parent delete order

1. `roadtour_claim_notification_logs`
2. `roadtour_survey_response_items`
3. `roadtour_survey_responses`
4. `roadtour_official_visits`
5. `roadtour_qr_delivery_logs`
6. `roadtour_scan_events`
7. `roadtour_qr_codes`
8. `roadtour_campaign_managers`
9. `roadtour_campaigns`
10. `points_transactions` rows with `transaction_type ILIKE 'roadtour%'`

NOT deleted: `roadtour_settings`, `roadtour_survey_templates`,
`roadtour_survey_template_fields`.

## 5. New table to introduce

`public.roadtour_runs`

Columns (minimum):

- `id uuid pk default gen_random_uuid()`
- `org_id uuid not null references organizations(id) on delete cascade`
- `name text not null`
- `description text null`
- `start_date date not null`
- `end_date date not null`
- `status text not null default 'draft' check (status in ('draft','active','completed','cancelled'))`
- `duplicate_policy text not null default 'per_run' check (duplicate_policy in ('per_run','per_campaign','per_day','none'))`
- `created_by uuid null`
- `updated_by uuid null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Indexes:
- `idx_roadtour_runs_org_status (org_id, status)`
- `idx_roadtour_runs_dates (start_date, end_date)`

Trigger: standard `updated_at` trigger using the project pattern from
`roadtour_campaigns`.

RLS: identical pattern to `roadtour_campaigns` admin policies (`is_admin_user()`
helper used elsewhere).

## 6. Tables that gain `roadtour_run_id`

| Table | New column | Source of value | Notes |
| --- | --- | --- | --- |
| `roadtour_campaigns` | `roadtour_run_id uuid NOT NULL FK -> roadtour_runs(id)` | required on create | safe NOT NULL after staging cleanup |
| `roadtour_qr_codes` | `roadtour_run_id uuid NOT NULL FK -> roadtour_runs(id)` | snapshot from campaign at creation | trigger to fill on insert |
| `roadtour_scan_events` | `roadtour_run_id uuid NULL FK -> roadtour_runs(id)` | snapshot from campaign at insert | filled by API |
| `roadtour_official_visits` | `roadtour_run_id uuid NULL FK -> roadtour_runs(id)` | snapshot at insert | partial unique index lives here |
| `roadtour_survey_responses` | `roadtour_run_id uuid NULL FK -> roadtour_runs(id)` | snapshot at insert | used for analytics filters |
| `roadtour_claim_notification_logs` | `roadtour_run_id uuid NULL FK -> roadtour_runs(id)` | snapshot at insert | filtering support |

## 7. Duplicate protection at DB level

Add partial unique index:

```sql
CREATE UNIQUE INDEX uq_roadtour_official_visit_per_run_shop
ON public.roadtour_official_visits (roadtour_run_id, shop_id)
WHERE visit_status = 'official' AND roadtour_run_id IS NOT NULL;
```

This guarantees one official visit per shop per RoadTour Event regardless of
which campaign/reference produced it.
