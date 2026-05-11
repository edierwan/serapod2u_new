# RoadTour Event Redesign Plan

Date: 2026-05-12  
Author: Coder AI (staging-only scope)  
Status: In progress

## 1. Problem statement

The current RoadTour module allows campaigns to exist directly without a parent
"visit scope". If two campaigns run in parallel during the same physical RoadTour
activity, the same shop can scan QR codes from different campaigns/references and
receive duplicate rewards. Reporting metrics (visits, references, points) are
also inflated.

## 2. Target hierarchy

```
RoadTour Event (table: roadtour_runs)
  └── Campaign (roadtour_campaigns)
        └── Campaign Reference Assignment (roadtour_campaign_managers)
              └── QR Code (roadtour_qr_codes)
                    └── Shop Scan (roadtour_scan_events)
                          ├── Survey Response (roadtour_survey_responses)
                          └── Reward Claim (points_transactions, roadtour_official_visits)
```

UI label: "RoadTour Event".  
DB table: `roadtour_runs` (singular conceptually = "RoadTour run").

## 3. Master vs transactional data

### Preserved master data (do NOT touch)

- `users`, `profiles`, `auth.users`
- `organizations` (incl. shop org rows)
- references / account managers (rows inside `users`)
- `roadtour_survey_templates` and `roadtour_survey_template_fields`
- `regions` / region master if present
- products, manufacturers, orders, purchase orders, cases
- CRM / loyalty master config
- `roadtour_settings` (org-level switches)
- normal loyalty / consumer / e-commerce data

### RoadTour transactional data eligible for staging reset

- `roadtour_campaigns`
- `roadtour_campaign_managers`
- `roadtour_qr_codes`
- `roadtour_qr_delivery_logs`
- `roadtour_scan_events`
- `roadtour_official_visits`
- `roadtour_survey_responses`
- `roadtour_survey_response_items`
- `roadtour_claim_notification_logs`
- `points_transactions` rows whose `transaction_type` matches `roadtour%`

## 4. Duplicate protection model

### New behaviour

- One accepted reward / claim per `shop_id` per `roadtour_run_id`.
- Default policy for first rollout: `per_run`.
- DB-level partial unique index on
  `(roadtour_run_id, shop_id) WHERE visit_status = 'official'`
  on `roadtour_official_visits` to enforce it.
- API also performs an idempotent pre-check returning a clean error message in
  Bahasa/English style:
  > "This shop has already participated in this RoadTour Event."

### Future policy values (stored on `roadtour_runs.duplicate_policy`)

- `per_run` — one shop once per event (default)
- `per_campaign` — current legacy behaviour
- `per_day` — one shop once per day per event
- `none` — no DB duplicate restriction

## 5. Phase plan and ownership

| Phase | Scope | Owner | Status |
| --- | --- | --- | --- |
| 0 — Discovery & docs | Inventory + plans | Coder AI | Done |
| 1 — Staging cleanup | Reset transactional rows | Coder AI on staging | Pending |
| 2 — Staging schema enhancement | Add `roadtour_runs`, FKs, indexes | Coder AI on staging | Pending |
| 3 — Server / API logic update | Campaign requires event, duplicate per run | Coder AI | Pending |
| 4 — UI/UX update | Event selector, Create Event modal, QR / Visits / Analytics filters | Coder AI | Pending |
| 5 — Staging tests | Typecheck, build, manual flow | Coder AI | Pending |
| 6 — Production scripts (not executed) | SQL files only | Manual owner run | Pending |

## 6. Critical safety rules

- No production SQL is executed by the AI.
- Master data is never deleted.
- All cleanup is wrapped in `BEGIN; ... COMMIT;`.
- Schema migration adds NOT NULL `roadtour_run_id` only **after** staging
  cleanup confirms zero `roadtour_campaigns` rows.
- All admin RLS / policies must keep current admin-org isolation.
