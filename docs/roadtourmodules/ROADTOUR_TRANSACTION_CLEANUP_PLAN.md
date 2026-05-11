# RoadTour Transaction Cleanup Plan

Date: 2026-05-12  
Scope: staging only (production script provided separately, not executed).

## 1. Goal

Reset all RoadTour **transactional** rows on staging so that the new
`roadtour_runs` parent can be introduced with `roadtour_campaigns.roadtour_run_id`
as `NOT NULL` without backfill complications.

## 2. Safety rules

- Wrap deletes in `BEGIN; ... COMMIT;`.
- Print before / after counts.
- Delete in child-to-parent FK order (see `ROADTOUR_DB_DISCOVERY.md` §4).
- Do NOT touch:
  - `roadtour_settings`
  - `roadtour_survey_templates`
  - `roadtour_survey_template_fields`
  - `users`, `profiles`, `auth.*`, `organizations`
  - `consumer_qr_scans`, `consumer_activations`, `consumer_feedback`,
    `shop_points_ledger`, `redeem_gift_transactions`
- For `points_transactions`, only rows with `transaction_type ILIKE 'roadtour%'`
  are removed. Other loyalty / refund / direct-scan rows stay.

## 3. Delete order (matches FKs)

1. `roadtour_claim_notification_logs`
2. `roadtour_survey_response_items`
3. `roadtour_survey_responses`
4. `roadtour_official_visits`
5. `roadtour_qr_delivery_logs`
6. `roadtour_scan_events`
7. `roadtour_qr_codes`
8. `roadtour_campaign_managers`
9. `roadtour_campaigns`
10. `points_transactions WHERE transaction_type ILIKE 'roadtour%'`

After delete, master-data sanity checks confirm
`roadtour_settings`, `roadtour_survey_templates`, `roadtour_survey_template_fields`,
`organizations`, `users` row counts are unchanged.

## 4. Scripts produced

- `docs/roadtourmodules/sql/staging_cleanup_roadtour_transactions.sql`
- `docs/roadtourmodules/sql/production_cleanup_roadtour_transactions.sql`
  (production-safe wording, manual run only, NOT executed by AI)

## 5. Recovery

Cleanup is destructive but only affects transactional data already created for
internal testing. No production data is impacted. If a rollback is needed, the
RoadTour module can be re-tested from a clean state.
