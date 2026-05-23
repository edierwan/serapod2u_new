# 23. RoadTour Duplicate Protection Participant Scope

Date: 2026-05-23

## Current issue

RoadTour Event grouping currently supports shop-level duplicate protection. The active event shown in production was:

- Event: `RoadTour 2026`
- Duplicate protection: `One shop once per event`

That policy is correct for rewards intended once per shop, but it is too strict for staff/shop-owner reward campaigns where multiple workers from the same shop should be able to claim independently.

User symptom from screenshots:

- modal title: `Already Claimed`
- message included: `This shop has already participated in this RoadTour Event (RoadTour 2026).`

## Old behavior

`per_run` / `One shop once per event` blocks a new claim when the same `shop_id` already has an official visit in the same `roadtour_run_id`.

This means Worker B from the same shop is blocked after Worker A claims, even if Worker B has a different account and phone number.

## New recommended behavior

Added duplicate protection option:

- `one_participant_once_per_event` - `One participant once per event`

Recommended for staff rewards:

- same authenticated user can claim once per event
- same normalized phone can claim once per event
- different workers from the same shop can claim independently
- same shop does not block another worker unless a shop-level policy is selected

Participant identity is:

- authenticated `user_id` when available
- normalized phone as fallback and secondary identity

## Duplicate protection options

The app now exposes these event policies:

1. `one_participant_once_per_event` - One participant once per event
2. `one_participant_once_per_campaign` - One participant once per campaign
3. `per_run` - One shop once per event
4. `per_campaign` - One shop once per campaign
5. `per_day` - One shop once per day
6. `none` - No duplicate restriction

## Exact duplicate logic

`one_participant_once_per_event` blocks when:

- same RoadTour Event (`roadtour_run_id`)
- and same authenticated `user_id` OR same normalized phone
- and a previous successful RoadTour scan/reward exists

It allows:

- same `shop_id`
- different `user_id`
- different normalized phone

`one_participant_once_per_campaign` blocks when:

- same campaign
- and same authenticated `user_id` OR same normalized phone
- and a previous successful RoadTour scan/reward exists

`per_run` keeps existing shop-level event behavior:

- same RoadTour Event
- same `shop_id`
- previous official visit exists

`per_campaign` keeps existing shop-level campaign behavior:

- same campaign
- same `shop_id`
- previous successful claim exists

`per_day` keeps existing shop-level daily behavior:

- same RoadTour Event
- same `shop_id`
- previous official visit exists today

`none` keeps existing no duplicate restriction behavior.

## Phone normalization

Participant duplicate checks normalize phone formats with the existing phone utility path.

These are treated as the same participant phone:

- `+60145600453`
- `0145600453`
- `60 14-560 0453`

New scan records store normalized participant phone when available so future comparisons are consistent.

## Event edit behavior

The RoadTour Campaign Management page now supports editing the selected RoadTour Event.

Admins can edit:

- Event Name
- Description
- Start Date
- End Date
- Status
- Duplicate Protection

Edit modal title:

- `Edit RoadTour Event`

Save button:

- `Save Changes`

Active-event warning:

- `Changing duplicate protection affects future claims only. Existing successful claims remain unchanged.`

This does not delete or rewrite successful claim history.

## Message changes

Participant-level duplicate:

- title: `Already Claimed`
- message: `This account or phone number has already claimed this RoadTour reward.`

Shop-level duplicate:

- title: `Shop Limit Reached`
- event message: `This shop has already reached the claim limit for this RoadTour event.`
- campaign message: `This shop has already reached the claim limit for this RoadTour campaign.`

The participant-level policy no longer shows `This shop has already participated...`.

## DB/schema assessment

No repository migration defining a `roadtour_runs.duplicate_policy` check constraint was found. The app treats `duplicate_policy` as a text value and now accepts the new participant-level values.

If a staging or production database has an out-of-band check constraint that is not represented in this repo, saving the new value will fail with a database error. In that case, a schema change must be approved separately. No SQL was created in this task.

## Files changed

- `app/src/lib/roadtour/duplicate-protection.ts`
- `app/src/lib/roadtour/events.ts`
- `app/src/app/api/roadtour/claim-reward/route.ts`
- `app/src/app/api/roadtour/events/[eventId]/route.ts`
- `app/src/modules/roadtour/components/CreateRoadtourEventDialog.tsx`
- `app/src/modules/roadtour/components/RoadtourCampaignsView.tsx`
- `app/src/modules/roadtour/components/RoadtourSettingsView.tsx`
- `app/src/components/journey/templates/PremiumLoyaltyTemplate.tsx`
- `app/src/modules/roadtour/components/RoadtourScanPage.tsx`

## Tests

Added focused tests:

- `app/src/lib/roadtour/duplicate-protection.test.ts`

Covered:

- participant phone normalization
- equivalent phone formats
- participant-level duplicate copy
- shop-level duplicate copy
- participant-level policy label

## Staging checklist

1. Open RoadTour Campaign Management on staging.
2. Select `RoadTour 2026`.
3. Click `Edit Event`.
4. Change Duplicate Protection to `One participant once per event`.
5. Save and confirm the badge updates to `Duplicate protection: One participant once per event`.
6. Worker 1 claims from Shop A with Phone A. Confirm success and points.
7. Worker 2 claims from the same Shop A with Phone B. Confirm success and points.
8. Worker 1 tries again with the same account or same normalized phone. Confirm blocked with `Already Claimed` and participant-level message.
9. Test phone variants `+60145600453`, `0145600453`, and `60 14-560 0453`. Confirm they are treated as the same participant.
10. Create or use a test event with `One shop once per event`.
11. Worker 1 claims from a shop, then Worker 2 from the same shop tries. Confirm blocked with `Shop Limit Reached`.
12. Confirm no SQL or migration file was created.