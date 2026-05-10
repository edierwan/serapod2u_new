# RoadTour Staging UAT

Date: 2026-05-10
Target: staging

## Goal

Validate the RoadTour fixes for campaign configuration, survey-backed reward claims, analytics accuracy, and admin visibility before any production move.

## Preconditions

- You can sign in to staging as a RoadTour admin for the target organization.
- The organization has at least one active survey template.
- The organization has at least one active RoadTour campaign and QR code, or you can create one during this test.
- You have one consumer login available for claim testing.

## Test 1: Campaign Requires Survey Template

Steps:

1. Open the RoadTour campaign create dialog in staging.
2. Set Reward Mode to Survey Submit.
3. Leave Survey Template empty.
4. Try to save.

Expected:

- Save is blocked.
- You see a validation error telling you to select a survey template.
- No broken or partially saved campaign is created.

## Test 2: Create or Edit a Valid Survey Campaign

Steps:

1. Create a new RoadTour campaign, or edit an existing one.
2. Set Reward Mode to Survey Submit.
3. Select an active survey template.
4. Save the campaign.
5. Reopen the same campaign.

Expected:

- Save succeeds.
- The selected survey template remains attached after reopen.
- Eligible references shown in the dialog belong to the same organization only.

## Test 3: Successful Survey Claim Flow

Steps:

1. Open a QR linked to the survey campaign.
2. Sign in as the consumer test user.
3. Complete the survey.
4. Submit the claim.

Expected:

- The claim completes without a 500 error.
- Reward success is shown to the user.
- The survey answers are actually persisted, including text, checkbox, number, and multi-select style answers where applicable.
- A second submission on the same QR follows the configured duplicate rule instead of crashing.

## Test 4: Auth Guard on Claim

Steps:

1. Open the same RoadTour QR in an incognito window or logged-out browser.
2. Try to continue to claim.

Expected:

- The request is rejected cleanly.
- The user sees a sign-in required style message.
- There is no silent failure and no raw database error is exposed.

## Test 5: Legacy Misconfiguration Guard

Steps:

1. If you have an older Survey Submit campaign created before this fix, open one of its QRs.
2. Attempt to claim.

Expected:

- If the campaign is missing a survey template, the flow stops with a clear configuration error.
- The request does not continue into a broken insert path.

## Test 6: Analytics Counts and Date Filter

Steps:

1. Open the RoadTour analytics page.
2. Note Total Scans, Total Visits, Total Surveys, and Top Campaigns.
3. Apply a narrow date filter that includes the claims you just tested.
4. Clear the date filter.

Expected:

- Total Scans reflects actual RoadTour scan events, not only the recent table page size.
- Top Campaigns scan counts reflect scan events rather than visit rows.
- Total Points Awarded changes with the filtered scan set.
- Changing the date filter resets recent scan pagination and refreshes the page correctly.

## Test 7: Survey Answer Integrity

Steps:

1. Use a survey containing at least a text field, checkbox, numeric field, and multi-select or select field.
2. Submit one complete response.
3. Review the stored response from the admin side if available.

Expected:

- Text answers appear as text.
- Numeric answers are stored as numbers.
- Checkbox or multi-select answers are not dropped.
- Empty or unsupported values do not create garbage rows.

## Test 8: Optional Claim Notification Check

Steps:

1. Use a campaign with assigned managers and RoadTour claim notifications enabled.
2. Perform one successful claim.
3. Check the notification history or message destination used by staging.

Expected:

- A claim notification record is created for the successful claim.
- If messaging is wired in staging, the manager-side notification arrives once.

## Evidence To Capture

- Screenshot of campaign save with survey template selected.
- Screenshot of a successful survey claim.
- Screenshot of the analytics page before and after a date filter.
- The exact user-facing error text for any failed step.
- If a failure occurs, the time of the attempt and the campaign name used.

## Pass Criteria

- A Survey Submit campaign cannot be saved without a template.
- A valid Survey Submit campaign can be saved and reopened with the template intact.
- A signed-in consumer can complete a survey claim successfully.
- A logged-out user is blocked cleanly.
- Analytics totals match the actual staging activity for the test window.