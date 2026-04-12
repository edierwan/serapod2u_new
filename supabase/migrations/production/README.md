# Pending Production SQL

This folder is a staging-prep checklist for SQL scripts that should be reviewed and run on production later.

Keep the original migration files in the main `supabase/migrations/` folder so local tooling and history stay intact.

Current production-later queue:

- `20260411_add_user_call_name.sql`
- `20260411_point_claim_mode_single_or_dual.sql`
- `20260412_dual_claim_and_taxonomy_phase1.sql`
- `20260412_dual_claim_and_taxonomy_phase2.sql`
- `20260412_consumer_claim_confirmation.sql`

*** Add File: /Users/macbook/serapod2u_main/supabase/migrations/20260412_consumer_claim_confirmation.sql
BEGIN;

ALTER TABLE public.users
	ADD COLUMN IF NOT EXISTS consumer_claim_confirmed_at timestamptz;

COMMENT ON COLUMN public.users.consumer_claim_confirmed_at IS
	'Timestamp set after an unlinked consumer confirms they want to keep collecting QR points as a consumer lane user.';

COMMIT;

*** Add File: /Users/macbook/serapod2u_main/supabase/migrations/production/20260412_consumer_claim_confirmation.sql
BEGIN;

ALTER TABLE public.users
	ADD COLUMN IF NOT EXISTS consumer_claim_confirmed_at timestamptz;

COMMENT ON COLUMN public.users.consumer_claim_confirmed_at IS
	'Timestamp set after an unlinked consumer confirms they want to keep collecting QR points as a consumer lane user.';

COMMIT;

*** Add File: /Users/macbook/serapod2u_main/docs/QR_CLAIM_FLOW_PRESENTATION.md
# QR Claim Flow Presentation

## Purpose

This document summarizes the proposed QR claim behavior for management review across single-claim and dual-claim modes, including the new consumer confirmation step for unlinked users.

## Core Terms

- Single claim mode: only the shop lane can collect QR points.
- Dual claim mode: shop lane and consumer lane can each collect their own lane-specific points for the same QR.
- Consumer lane: a logged-in user without a linked shop context.
- Shop lane: a shop user or an independent user who has completed `Shop Name` and `Reference` and explicitly claims as shop.

## Single Claim Mode

### Business rule

Only shop lane collection is allowed.

### Flow

1. User scans QR.
2. System validates QR status and organization settings.
3. If the user is not authenticated, the system shows login.
4. After login:
	 - If user has shop lane access, points are collected.
	 - If user is missing `Shop Name` or `Reference`, the system routes the user to Profile Information.
5. If the QR was already claimed for the shop lane, the system shows the already-collected result.

### Presentation message

Single claim mode is the controlled operational mode for shop-staff-only campaigns.

## Dual Claim Mode

### Business rule

The same QR can support two independent point claims:

- one for shop lane
- one for consumer lane

Each lane is tracked separately.

## Dual Claim: Shop Lane Flow

1. User scans QR.
2. User logs in or uses an active session.
3. System checks whether the user is a shop account or has completed shop linking in profile.
4. If profile is incomplete, the system prompts for `Shop Name` and `Reference` in Profile Information.
5. User collects shop-lane points.
6. If the consumer lane already claimed first, shop lane can still collect its own lane in dual mode.

### Presentation message

Dual mode protects shop incentives while still allowing consumer engagement.

## Dual Claim: Consumer Lane Flow

1. User scans QR.
2. User logs in or uses an active session.
3. If the user has no linked shop context, the system identifies the user as consumer lane.
4. Before first consumer-lane collection, the system asks:

> You're not linked to any shop yet. Continue collecting points as a consumer?

5. The user chooses one of two actions:
	 - `Yes`
	 - `Link to Shop`

### If user selects Yes

1. System records `consumer_claim_confirmed_at` on the user record.
2. System continues with consumer-lane collection.
3. Next time, the same user is not asked again.

### If user selects Link to Shop

1. System opens `Account Settings`.
2. Profile Information is expanded automatically.
3. User updates:
	 - `Shop Name`
	 - `Reference`
4. Future claims can proceed through shop-linked logic instead of pure consumer lane.

### Presentation message

The confirmation protects business intent by making unlinked collection explicit once, without repeatedly interrupting the same consumer.

## Decision Matrix

| Scenario | Result |
| --- | --- |
| Single mode + consumer lane user | blocked, shop-only campaign |
| Dual mode + unlinked first-time consumer | confirmation required |
| Dual mode + confirmed unlinked consumer | direct consumer collection |
| Dual mode + linked independent user choosing shop lane | shop-lane collection allowed |
| Dual mode + lane already collected | only remaining lane may collect |

## Data Change

New user-level indicator:

- `public.users.consumer_claim_confirmed_at`

Purpose:

- persist one-time confirmation for consumer-lane collection
- avoid showing the same prompt again after confirmation

## Staging Test Script

### Test 1: First-time consumer confirmation

1. Use a dual-claim QR on staging.
2. Log in with a user that has no `Shop Name` and no `Reference`.
3. Confirm the modal appears before points are awarded.
4. Click `Yes`.
5. Confirm points are awarded.
6. Repeat with another QR and verify the confirmation modal does not appear again for the same user.

### Test 2: Link to shop path

1. Use a dual-claim QR on staging.
2. Log in with a user that has no `Shop Name` and no `Reference`.
3. When the confirmation modal appears, click `Link to Shop`.
4. Confirm the app opens `Account Settings` with `Profile Information` expanded.
5. Update `Shop Name` and `Reference`.
6. Retry the QR flow and validate the shop-linked path.

### Test 3: Existing confirmed consumer

1. Use the same confirmed consumer from Test 1.
2. Scan a new dual-claim QR.
3. Confirm there is no repeat confirmation modal.
4. Confirm points collect normally as consumer lane.

### Test 4: Shop lane still works

1. Use a user with shop lane eligibility.
2. Scan a dual-claim QR.
3. Confirm shop lane can still claim without the consumer confirmation prompt.

## Management Summary

- Single mode remains strict for staff-only campaigns.
- Dual mode now separates shop and consumer incentives more clearly.
- Unlinked consumers must acknowledge their lane once.
- The acknowledgement is persisted, so the experience stays smooth on later scans.
- Users who want attribution to a shop are guided into the existing profile-linking flow instead of being blocked without direction.

Staging-only scripts that should not be moved into the production queue:

- `20260411_staging_legacy_shop_lane_cleanup.sql`
- `20260411_staging_restore_shop_staff_attribution_template.sql`
