# 28. Product QR Milestone Schema Proposal

Date: 2026-05-24

Implementation status update, 2026-05-24:
- Phase 3 staging implementation accepted this proposal's safe first-release direction
- first implementation is one-time reward only per participant mission
- supported counting periods are `rolling_1_month`, `rolling_2_months`, and `open_period`
- same-period repeat reward cycles remain deferred and are not part of the first staging build
- implementation details are tracked in `30-product-qr-milestone-staging-implementation.md`

Proposal scope:
- schema design proposal only
- conceptual persistence model only
- conceptual security and reporting model only
- documentation only

Explicit non-scope for this document:
- no SQL
- no migrations
- no app code changes
- no API changes
- no UI changes
- no deployment
- no change to current RoadTour reward behavior
- no change to current Product QR behavior
- no change to current points ledger behavior

## 1. Executive Summary

Accepted product direction for this Phase 2 proposal:
- RoadTour QR = enrollment and mission start
- Product QR scan = progress toward RoadTour reward
- reward owner = participant user and normalized phone, not shop
- shop remains reporting context only
- campaign Reward Points remains the point amount source
- Event-level rule controls when campaign points are released
- rolling period starts from participant enrollment time, not calendar month
- an existing participant period keeps its original rule snapshot even if admins later change the target

Main schema conclusion:
- the current database is not sufficient for safe deferred milestone release
- a future implementation needs four conceptual persistence layers:
  - rule version storage
  - participant mission storage
  - counted Product QR item storage
  - payout idempotency storage

Clear recommendation:
- safest first release = one reward per participant per rolling period
- optional advanced release = repeat cycles inside the same rolling period, but only with explicit cycle tracking and `max_cycles_per_period`

Why this distinction matters:
- the first release can stay much simpler and safer
- repeat cycles inside the same rolling period change the schema shape materially
- if repeat is a real business requirement later, Phase 2 must reserve for cycle-specific persistence rather than trying to add it as a small patch afterward

## 2. Unresolved Product Decision

This is the one major unresolved product decision that must stay visible before any future Phase 3 migration work:

Current safe production recommendation:
- one reward per participant per rolling period

Possible future business request:
- repeat reward cycles inside the same rolling period
- example: every 3 unique Product QR scans inside one active rolling month earns another campaign reward

Why this is unresolved:
- supporting repeats inside the same period is not just a flag change
- it requires explicit cycle tracking
- it requires a cap such as `max_cycles_per_period`
- it requires cycle-aware dedupe so the same Product QR never gets reused incorrectly
- it requires stronger payout idempotency because multiple rewards could be legitimate within one mission window

Required design consequence if repeat is needed later:
- Phase 2 schema must include cycle-aware mission tracking and `max_cycles_per_period`

Recommended default if product does not decide yet:
- design the schema so repeat can be added later
- launch the first production version as one reward per participant per rolling period

## 3. Design Principles

This proposal follows these principles:
- Event-level rule decides release timing, not campaign reward amount
- campaign keeps the points amount source
- participant identity owns reward entitlement
- shop is contextual reporting only
- rule snapshots are immutable for an active participant period
- Product QR dedupe uses resolved `qr_code_id`, not raw QR text
- payout idempotency must be explicit, not inferred from ledger rows later
- repo and schema drift must be treated as a real delivery risk

## 4. Proposed Rule Version Table

Recommended conceptual table name:
- `roadtour_event_reward_rule_versions`

Recommended grain:
- one row per Event-level milestone rule version

Purpose:
- store the release rule history for an Event
- allow future periods to adopt a new rule without rewriting old participant entitlement
- provide an immutable source for mission snapshots

Recommended conceptual columns:

| Column | Purpose | Notes |
| --- | --- | --- |
| `id` | primary identifier | stable rule version key |
| `roadtour_event_id` | parent Event | links rule to one Event |
| `version_no` | human and system ordering | monotonic within the Event |
| `status` | draft, active, superseded, retired | supports controlled rollout |
| `point_release_rule` | release mode | for this proposal, Product QR milestone mode |
| `required_product_qr_scans` | target count | integer target for completion |
| `period_type` | rolling period definition | first supported value should be `rolling_month` |
| `repeat_reward` | whether repeats are allowed | default false for first release |
| `max_cycles_per_period` | cycle cap | nullable if repeat is off; mandatory if repeat is on in future |
| `unique_product_qr_only` | dedupe policy | recommended true |
| `eligible_product_scope` | product filter metadata | supports future all-products versus selected-products choice |
| `effective_from` | rule start time | used for future participant periods |
| `effective_to` | rule end time | nullable for current active version |
| `change_reason` | admin rationale | auditability |
| `created_at` | audit timestamp | server set |
| `created_by` | actor | admin or system |
| `metadata` | extensibility | room for future controlled fields |

Recommended behavior:
- only one active rule version per Event at a time
- changing the Event rule should create a new version row, not mutate the old one in place
- `effective_to` on the old row should close only future applicability, not invalidate existing missions

## 5. Proposed Participant Mission Table

Recommended conceptual table name:
- `roadtour_participant_missions`

Recommended grain:
- one row per Event + Campaign + participant + rolling period

Purpose:
- represent one participant's active or historical RoadTour milestone entitlement period
- persist the rule snapshot and time boundaries
- track completion, expiry, and payout state

Recommended conceptual columns:

| Column | Purpose | Notes |
| --- | --- | --- |
| `id` | primary identifier | stable mission id |
| `roadtour_event_id` | parent Event | required |
| `roadtour_campaign_id` | parent Campaign | required because campaign points remain the amount source |
| `participant_user_id` | participant user link | nullable only if identity is phone-only at enrollment finalization time |
| `participant_phone_normalized` | normalized participant identity | required for fallback identity and anti-abuse review |
| `participant_identity_type` | identity basis | user, phone, or user_and_phone snapshot |
| `enrollment_scan_event_id` | RoadTour enrollment anchor | links mission back to the RoadTour claim or enrollment event |
| `enrolled_at` | mission start time | business start of rolling period |
| `period_start` | stored rolling-period start | normally same as `enrolled_at` |
| `period_end` | stored rolling-period end | exclusive boundary |
| `effective_period_end` | truncated actual end if Event or Campaign ends earlier | keeps natural end and actual end separate if desired |
| `reward_rule_version_id` | rule version link | ties mission to immutable Event rule version |
| `required_product_qr_scans_snapshot` | frozen target | copied from rule version |
| `campaign_reward_points_snapshot` | frozen payout amount | copied from campaign at mission creation |
| `repeat_reward_snapshot` | frozen repeat setting | copied from rule version |
| `max_cycles_per_period_snapshot` | frozen cycle cap | copied from rule version |
| `unique_product_qr_only_snapshot` | frozen dedupe setting | copied from rule version |
| `current_valid_product_scan_count` | cached progress | derived from counted items |
| `completed_cycle_count` | cycle progress | defaults to 0 |
| `reward_status` | pending, completed, awarded, expired, cancelled | high-level mission state |
| `current_cycle_no` | active cycle number | first release can stay `1` always |
| `shop_id` | reporting context | never reward owner |
| `last_progress_at` | last counted Product QR time | reporting and support |
| `completed_at` | when target was met | separate from awarded_at |
| `awarded_at` | when payout was actually posted | important for audit |
| `expired_at` | when mission expired | nullable |
| `created_at` | audit timestamp | server set |
| `created_by` | actor or system | server set |
| `metadata` | extensibility | room for edge-case context |

Recommended identity rules:
- reward ownership should resolve to participant identity, not shop
- mission should snapshot both user and normalized phone when available
- shop changes after enrollment must not rewrite historical mission ownership or payout entitlement

## 6. Proposed Counted Product QR Item Table

Recommended conceptual table name:
- `roadtour_mission_counted_product_qr_items`

Recommended grain:
- one row per Product QR event evaluated for a mission

Purpose:
- create an auditable counted-scan history
- support mission-level dedupe
- explain why a scan counted or did not count
- support future cycle tracking if repeat is enabled later

Recommended conceptual columns:

| Column | Purpose | Notes |
| --- | --- | --- |
| `id` | primary identifier | stable counted-item id |
| `mission_id` | parent mission | required |
| `cycle_no` | cycle number | defaults to `1`; becomes important if repeat is enabled |
| `product_scan_event_id` | source Product QR scan row | links to `consumer_qr_scans.id` |
| `resolved_qr_code_id` | stable Product QR identifier | use `qr_codes.id` via resolved scan record |
| `product_id` | product reporting dimension | copied for reporting convenience |
| `raw_qr_code_text` | optional support field | not used as primary dedupe key |
| `scanned_at` | source event timestamp | required |
| `counted_at` | when milestone engine accepted or evaluated it | server-set |
| `participant_user_id_snapshot` | copied identity | helps audit if source user later changes |
| `participant_phone_normalized_snapshot` | copied identity | helps audit and anti-abuse review |
| `is_counted` | whether the item increments progress | explicit true or false |
| `is_duplicate` | duplicate flag | true when blocked |
| `duplicate_reason` | duplicate explanation | same QR in mission, outside period, before enrollment, and so on |
| `cycle_consumed` | whether the item was assigned to a payout cycle | future-safe for repeat mode |
| `metadata` | extensibility | edge cases, rule evaluation notes, resolver context |
| `created_at` | audit timestamp | server set |

Recommended evaluation behavior:
- record evaluation against a mission, not just final successful counting
- allow audit of rejected scan items when useful
- do not rely on raw Product QR text for dedupe because multiple text forms can resolve to the same QR row

## 7. Proposed Payout and Idempotency Model

Recommended conceptual table name:
- `roadtour_mission_payouts`

Purpose:
- make milestone payout idempotent and auditable
- separate mission completion from actual ledger posting

Recommended conceptual columns:

| Column | Purpose | Notes |
| --- | --- | --- |
| `id` | primary identifier | stable payout id |
| `mission_id` | mission link | required |
| `cycle_no` | payout cycle number | `1` for first release |
| `participant_user_id` | payout owner | required when ledger write occurs |
| `participant_phone_normalized` | payout identity snapshot | required for audit |
| `campaign_reward_points_snapshot` | payout amount snapshot | immutable once created |
| `points_transaction_id` | ledger link | points ledger row id |
| `idempotency_key` | uniqueness anchor | required |
| `payout_status` | pending, posted, failed, reversed | operational control |
| `qualified_at` | when target was satisfied | separate from posting |
| `posted_at` | when ledger was written | audit |
| `failure_reason` | failure storage | nullable |
| `created_at` | audit timestamp | server set |
| `metadata` | extensibility | payout debug and support fields |

Recommended idempotency rule:
- one payout row per `mission_id + cycle_no`
- one ledger transaction should link back to one payout row
- do not attempt to infer milestone uniqueness from `points_transactions` text fields alone

Recommended ledger linkage:
- payout row should hold the definitive reference to `points_transactions.id`
- the points ledger row should later carry enough metadata to identify the payout source as a RoadTour milestone payout
- do not rely only on `transaction_type = 'roadtour'` because immediate RoadTour claims already use RoadTour-oriented transaction types today

Assessment:
- explicit payout storage is safer than trying to use `points_transactions` as both ledger and entitlement state

## 8. Cycle and Repeat Design Option

Safest first release:
- no same-period repeat cycles
- one reward per participant per rolling period
- one mission row per participant period
- `completed_cycle_count` can remain `0` or `1`
- `current_cycle_no` can remain `1`

Optional advanced release:
- allow repeat cycles inside the same rolling period
- each cycle requires another full set of valid unique Product QR scans
- cycle count must not exceed `max_cycles_per_period`

If advanced repeat is approved later, additional conceptual rules are required:
- same Product QR counted in cycle 1 must never count again for later cycles in the same mission
- cycle 2 should start only after cycle 1 is qualified and a payout row is reserved or posted
- `max_cycles_per_period` must be enforced at mission and payout level
- cycle number must be stored on counted Product QR items and payout rows

Recommended repeat design stance:
- reserve schema compatibility for cycles now
- launch without same-period repeats first

Why this is the safest split:
- it keeps Phase 3 migration scope smaller
- it keeps payout idempotency straightforward
- it avoids abuse from rapid repeated scanning inside one active period

## 9. Rolling Period Date Calculation Rules

Recommended rules:
- timezone authority = `Asia/Kuala_Lumpur`
- `period_start = enrolled_at`
- `natural_period_end = same local wall-clock time next calendar month`
- if that day does not exist in the target month, clamp to the last valid local day
- valid counting window = `scanned_at >= period_start` and `scanned_at < effective_period_end`
- `effective_period_end = min(natural_period_end, event_end_exclusive, campaign_end_exclusive)`

Examples:
- `2026-05-15 10:00 MYT` -> `2026-06-15 10:00 MYT`
- `2026-05-31 10:00 MYT` -> `2026-06-30 10:00 MYT`
- `2027-01-31 10:00 MYT` -> `2027-02-28 10:00 MYT`
- `2028-01-31 10:00 MYT` -> `2028-02-29 10:00 MYT`

Recommended storage behavior:
- persist the computed mission period boundaries at mission creation time
- never recompute the current participant period from the latest Event rule on read

## 10. Effective Rule History

Recommended history behavior:
- a rule change creates a new rule version row
- old row gets `effective_to`
- new row gets `effective_from`
- only new missions or new future periods use the new version

Recommended history semantics:
- `effective_from` and `effective_to` define when a version is eligible to seed new mission periods
- they do not redefine already-created participant missions

Recommended admin behavior:
- if admin changes target from `3` to `5`, open missions remain on their old snapshot
- new participants after the change use the new rule
- a participant's next rolling period may use the new rule if the new version is active then

## 11. Mission Rule Snapshot Behavior

Required snapshot behavior:
- mission keeps its own immutable copy of the rule values that mattered at creation time

Recommended mission snapshot fields:
- `reward_rule_version_id`
- `required_product_qr_scans_snapshot`
- `campaign_reward_points_snapshot`
- `repeat_reward_snapshot`
- `max_cycles_per_period_snapshot`
- `unique_product_qr_only_snapshot`
- `period_start`
- `period_end`

Why the snapshot is required:
- avoids entitlement drift when admins edit live Event settings
- makes support and reporting easier
- protects historical payout explanations

Recommended behavior on completion:
- completed and awarded missions remain immutable
- pending missions stay on their original snapshot until they end or are explicitly cancelled under a later business rule

## 12. Product QR Dedupe Strategy

Recommended dedupe key for milestone counting:
- `mission_id + resolved_qr_code_id`

If same-period repeat cycles are ever enabled later:
- still do not allow the same `resolved_qr_code_id` to count twice in the same mission
- cycle logic should consume fresh QR rows only

Why resolved `qr_code_id` is mandatory:
- `app/src/lib/utils/qr-resolver.ts` shows raw QR text can arrive in multiple forms
- exact code, base code, and truncated pattern matches can still resolve to the same canonical QR row
- dedupe by raw text would be unsafe

Recommended source event for counting:
- use validated Product QR scan or collect event rows that can be tied to a participant identity and `qr_code_id`
- do not count anonymous page views

## 13. Points Ledger Linkage

Recommended linkage model:
- mission payout record is the entitlement layer
- `points_transactions` remains the ledger layer
- mission payout should reference the final ledger row by `points_transaction_id`

Recommended ownership rule:
- ledger payout owner must be participant-focused
- shop can remain reporting context only
- do not credit the shop as milestone owner

Recommended transaction semantics for future implementation:
- RoadTour milestone payout should be distinguishable from current immediate RoadTour claim reward
- reward amount should come from campaign snapshot, not from whatever the campaign currently says at payout time

## 14. RLS and Security Concept

Recommended access posture:
- no direct client writes to future mission, counted-item, payout, or rule-version tables
- all writes should happen through server-controlled flows later
- admin reads should stay Event and org scoped
- participant self-service visibility, if ever added, should be narrowly scoped to their own mission rows only

Recommended conceptual read rules:
- HQ or permitted RoadTour admins can read Event-level rule versions, missions, counted items, and payouts inside their allowed org scope
- account managers should only read rows for Events or Campaigns they are permitted to see
- shops should not get broad milestone admin visibility by default
- participants should not be able to enumerate other participant missions

Recommended conceptual write rules:
- only backend service flows create missions
- only backend service flows evaluate Product QR items into mission progress
- only backend service flows create payout rows and ledger links

Recommended security controls:
- use server timestamps, not client timestamps, for mission state changes
- lock or serialize payout creation to avoid double-award race conditions
- retain normalized phone snapshot for anti-abuse review

## 15. Schema Drift and Type Generation Risk

Current risk already observed in the repo:
- live staging has `roadtour_runs` and `roadtour_run_id` links
- `app/src/types/database.ts` still omits `roadtour_runs`
- some Event SQL exists in `docs/roadtourmodules/sql/staging_enhance_roadtour_event_schema.sql` instead of `supabase/migrations`
- `consumer_qr_scans` generated types are behind the live schema and omit newer fields such as `claim_lane`

Why this matters for Phase 2 and later:
- a milestone implementation built on drifting types will invite `as any` usage
- that weakens compile-time guarantees exactly where entitlement and payout logic need precision
- future migrations must include a synchronized schema dump and generated type refresh plan

Recommended delivery rule:
- no Phase 3 migration should be approved without a paired type-generation and schema-parity step

## 16. Proposed Implementation Phases

### Phase 2A

Schema proposal only.

Output:
- approved conceptual objects
- approved repeat-cycle stance for first release

### Phase 2B

Product decision lock.

Output:
- confirm whether same-period repeat cycles are out of scope for first release
- if not, confirm `max_cycles_per_period` default and cycle semantics

### Phase 3

SQL migration, after approval only.

Output:
- rule version persistence
- mission persistence
- counted Product QR item persistence
- payout idempotency persistence

### Phase 4

Type generation and schema parity refresh.

Output:
- generated DB types aligned with live schema
- Event schema no longer hidden only in docs SQL packs

### Phase 5

Event settings implementation.

Output:
- Event-level release rule settings
- warning and effective-date behavior

### Phase 6

Enrollment persistence.

Output:
- RoadTour enrollment creates or finalizes participant mission state

### Phase 7

Product QR progress hook.

Output:
- Product QR events evaluate into mission progress using resolved `qr_code_id`

### Phase 8

Payout posting and ledger idempotency.

Output:
- one safe payout per qualified mission or cycle

### Phase 9

Reporting and monitoring.

Output:
- mission dashboards
- near-target views
- payout audit views

### Phase 10

Staging QA and rollback plan.

Output:
- concurrency testing
- anti-abuse checks
- rollback path for payout defects

## 17. Open Product-Owner Decisions

These decisions should be closed before any migration work starts:

| Decision | Recommended default |
| --- | --- |
| First release allows only one reward per participant per rolling period? | Yes |
| Same-period repeat cycles needed in first release? | No |
| If repeats are later allowed, should they use `max_cycles_per_period`? | Yes |
| If participant joins on 31 May, should end be 30 June or 1 July? | 30 June |
| Should eligible Product QR scans be all products or only selected products? | Prefer explicit eligible-product scoping |
| Should Product QR scans before RoadTour enrollment ever count? | No |
| Should old pending missions keep the old target when admin changes `3` to `5`? | Yes |
| Should new rule apply to new participants and new future periods only? | Yes |
| Should shop reassignment after enrollment affect reward ownership? | No |
| Should anonymous Product QR page views count as progress? | No |

Additional unresolved advanced design choice:
- if same-period repeats are ever approved later, should cycle 2 start immediately after cycle 1 qualifies, or only after cycle 1 payout is posted?

Recommended answer:
- only after cycle 1 payout is successfully reserved or posted, to keep idempotency simpler

## 18. Files Inspected For This Proposal

- `docs/roadtourmodules/27-product-qr-milestone-rolling-period-assessment.md`
- `docs/roadtourmodules/20-registration-attribution-schema-proposal.md`
- `app/src/lib/roadtour/events.ts`
- `app/src/modules/roadtour/components/CreateRoadtourEventDialog.tsx`
- `app/src/modules/roadtour/components/RoadtourCampaignsView.tsx`
- `app/src/app/api/roadtour/claim-reward/route.ts`
- `app/src/app/api/roadtour/events/[eventId]/route.ts`
- `app/src/lib/roadtour/registration-context.ts`
- `app/src/lib/actions.ts`
- `app/src/app/api/consumer/track-scan/route.ts`
- `app/src/app/api/consumer/collect-points/route.ts`
- `app/src/app/api/consumer/collect-points-auth/route.ts`
- `app/src/lib/utils/qr-resolver.ts`
- `app/src/types/database.ts`
- `app/src/utils/phone.ts`
- `app/src/lib/utils.ts`
- `shared/phone/index.js`
- `supabase/migrations/20260408_roadtour.sql`
- `supabase/migrations/20260410_user_registration_bonus_and_roadtour_defaults.sql`
- `supabase/migrations/20260412_dual_claim_and_taxonomy_phase2.sql`
- `supabase/migrations/20260510_roadtour_hardening_and_org_rls.sql`
- `supabase/migrations/20260523_roadtour_duplicate_policy_participant_support.sql`
- `docs/roadtourmodules/sql/staging_enhance_roadtour_event_schema.sql`
- `docs/roadtourmodules/ROADTOUR_EVENT_REDESIGN_PLAN.md`
- `docs/roadtourmodules/README.md`
- read-only staging `information_schema` query for current RoadTour, Product QR, and points tables

## 19. Final Recommendation

Recommended first release:
- one reward per participant per rolling period
- no same-period repeat cycles
- first staging build uses one-time reward only for the participant mission
- first staging build exposes period options: 1 month from enrollment, 2 months from enrollment, and open period
- immutable mission rule snapshots
- dedupe by `mission_id + resolved_qr_code_id`
- explicit payout idempotency layer before ledger write

Recommended advanced release, only if business later confirms it:
- repeat cycles inside the same rolling period
- must include cycle tracking
- must include `max_cycles_per_period`
- must include cycle-aware counted-item and payout controls

Overall conclusion:
- the milestone design is supportable
- but it should be implemented as a proper deferred entitlement model, not by stretching the current immediate-claim RoadTour tables beyond their intended purpose

## 20. Documentation-Only Confirmation

Confirmed for this task:
- no SQL written
- no migration written
- no app code changed
- no API code changed
- no UI code changed
- no deployment performed