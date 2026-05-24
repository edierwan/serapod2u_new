# 30. Product QR Milestone Staging Implementation

Date: 2026-05-24

Scope:
- staging implementation only
- no production deployment
- no production data modification
- Event-level Product QR milestone reward settings
- one-time milestone reward only
- no same-period repeat reward cycles

## 1. Summary

This staging build implements RoadTour Product QR Milestone Reward as a deferred entitlement flow:
- RoadTour QR claim enrolls the participant into a mission when the Event release rule is milestone-based
- Product QR collection after enrollment increments mission progress
- campaign Reward Points remain configured on the RoadTour campaign
- the RoadTour Event controls only when those campaign points are released
- payout owner is the participant/user/phone, not the shop
- shop remains reporting context

Immediate RoadTour reward logic remains available through the Event release rule `immediate_after_roadtour_claim`.

## 2. Database Changes

Migration:
- `supabase/migrations/20260524_roadtour_product_qr_milestone_reward.sql`

Event rule columns added to `roadtour_runs`:
- `point_release_rule`
- `required_product_qr_scans`
- `product_qr_counting_period`
- `unique_product_qr_only`
- `active_reward_rule_version_id`

New tables:
- `roadtour_event_reward_rule_versions`
- `roadtour_participant_missions`
- `roadtour_mission_counted_product_qr_items`
- `roadtour_mission_payouts`

New or updated database functions:
- `roadtour_normalize_phone_key`
- `roadtour_calculate_mission_period`
- `roadtour_mission_response`
- `roadtour_create_participant_mission`
- `roadtour_record_product_qr_milestone_progress`
- `consumer_collect_points` now also returns `scan_id`, `qr_code_id`, and `scanned_at`

The migration was applied to staging database `supabase` as `supabase_admin` because existing RoadTour tables are owned by that role.

## 3. Rule Version Behavior

Event rule changes create a new active rule version through database triggers.

Existing missions keep immutable snapshots:
- reward rule version
- required Product QR scan target
- campaign Reward Points
- counting period boundaries
- unique Product QR setting

Changing an Event rule affects future participant missions only. Existing progress, completed rewards, and awarded points remain unchanged.

## 4. Mission And Progress Behavior

Enrollment:
- created by `/api/roadtour/claim-reward`
- only for Events using `product_qr_scan_target_once`
- scans before enrollment do not count
- anonymous Product QR page views do not count

Progress:
- Product QR collection routes call `roadtour_record_product_qr_milestone_progress`
- the same resolved Product QR cannot count more than once for the same mission
- duplicate Product QR scans are recorded as non-counted evaluations
- once target is reached, the mission is awarded once

Period options:
- `rolling_1_month`: one month from enrollment
- `rolling_2_months`: two months from enrollment
- `open_period`: until the campaign/event effective end

All period boundaries use the stored mission snapshot and are not recomputed from edited Event rules.

## 5. Payout Idempotency

Milestone payout uses `roadtour_mission_payouts` before writing to `points_transactions`.

First version guarantees:
- one payout per mission
- one idempotency key per payout
- no shop wallet award
- participant/user receives the campaign snapshot point amount
- repeat reward cycles are not implemented

## 6. App Changes

Backend:
- `app/src/lib/roadtour/milestone.ts`
- `app/src/app/api/roadtour/claim-reward/route.ts`
- `app/src/app/api/consumer/collect-points/route.ts`
- `app/src/app/api/consumer/collect-points-auth/route.ts`
- `app/src/app/api/roadtour/events/[eventId]/route.ts`

Frontend:
- `app/src/lib/roadtour/events.ts`
- `app/src/modules/roadtour/components/CreateRoadtourEventDialog.tsx`
- `app/src/modules/roadtour/components/RoadtourCampaignsView.tsx`
- `app/src/modules/roadtour/components/RoadtourScanPage.tsx`
- `app/src/components/journey/templates/PremiumLoyaltyTemplate.tsx`

Generated types:
- `app/src/types/database.ts` regenerated from staging after migration

## 7. Admin UI

The Product QR milestone setting is implemented at RoadTour Event level only, inside the Create/Edit RoadTour Event modal.

Controls:
- Point Release Rule
- Required Product QR scans
- Counting Period
- Scope: Per participant / phone
- Unique Product QR scans locked on
- preview text
- rule-change warning

Campaign Reward Points remain inside Create/Edit RoadTour Campaign. No Reward Points field was added to the Event modal.

## 8. Staging Validation Checklist

Validated so far:
- migration applied to staging
- new tables, columns, triggers, and RPCs exist
- generated database types include milestone schema
- focused Vitest coverage for milestone normalization passes
- VS Code diagnostics are clean for touched implementation files checked during development

Manual staging checks still recommended:
- Immediate Event rule still awards RoadTour points immediately
- Milestone Event rule creates mission and awards 0 immediate points
- Product QR scan after enrollment increments progress
- Product QR scan before enrollment does not count
- duplicate resolved Product QR does not increment progress
- target completion awards once only
- additional Product QR scans after award do not create another payout
- Event rule edit creates a new active rule version
- old mission keeps old target after Event rule edit
- Event modal contains no Reward Points field

## 9. Rollback Notes

No production rollback is required because this implementation is staging-only.

If staging rollback is needed:
- switch affected Events back to `immediate_after_roadtour_claim`
- stop using the milestone Product QR Event setting
- preserve milestone tables for audit until payouts are reviewed
- do not drop payout or mission tables after any awarded test payouts without first reconciling `points_transactions`

## 10. Schema Drift Found

Before implementation, staging schema had RoadTour Event and Product QR fields missing from the checked-in generated types.

Resolution:
- migration was applied against the live staging database
- `app/src/types/database.ts` was regenerated from staging
- new backend code uses typed RPC helpers instead of hiding drift with `as any`