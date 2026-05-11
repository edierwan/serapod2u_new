# RoadTour Event — Staging Test Plan

> Run all scenarios on staging only after deploy completes.

## Prereqs
- Staging cleanup script `staging_cleanup_roadtour_transactions.sql` already executed (no transactional rows left).
- Schema enhancement `staging_enhance_roadtour_event_schema.sql` already executed.
- Login as `SA` / `HQ` / `POWER_USER` / `HQ_ADMIN` / `SUPER_ADMIN` / `ADMIN`.

## Scenario A — Empty state
1. Open RoadTour → Campaigns.
2. Expect the amber "No RoadTour Event yet" empty state. `Create Campaign` is disabled.
3. Click `Create RoadTour Event`. Create with default fields (status active, policy per_run).
4. Expect blue event-selector card to appear with status badge and duplicate-protection pill.

## Scenario B — Campaign creation tied to event
1. With one event active, click `Create Campaign`.
2. Modal opens with Section 0 (RoadTour Event) auto-selected to the active event.
3. Fill required fields and Save.
4. Expect campaign row to appear; "Event" column shows the event name.
5. Switch event selector to a different event — table filters accordingly.

## Scenario C — Per-run duplicate protection
1. With event policy `per_run`, scan a QR (via consumer flow) for a shop. Reward succeeds.
2. Scan another QR in the **same event** for the **same shop** (any campaign).
3. Expect 409 with message _"This shop has already participated in this RoadTour Event (Event Name)."_
4. Switch to a different event and scan the same shop → reward should succeed.

## Scenario D — QR Management filter
1. Open RoadTour → QR Management.
2. Use the new `All RoadTour Events` dropdown to pick an event.
3. Campaign dropdown narrows; QR groups filter to that event.

## Scenario E — Visits filter
1. Open RoadTour → Visits.
2. Pick an event in the `All Events` filter. Verify metrics + table scope.
3. Combine with date range; both filters apply.

## Scenario F — Analytics filter
1. Open RoadTour → Analytics.
2. Pick an event in the new `RoadTour Event` selector.
3. KPI cards, top campaigns, recent scans, etc., all scope to that event.

## Scenario G — Settings note
1. Open RoadTour → Settings.
2. Verify the new emerald note "Duplicate Protection now lives on the RoadTour Event."

## Scenario H — Draft event
1. Create a `draft` event.
2. Confirm campaigns can still be assigned to it (auto-selected only after switching active runs).
3. Activate it later by editing in DB (UI edit dialog is future work).

## Regression checks
- Legacy campaigns (none expected after cleanup) — verify `roadtour_run_id` is populated by snapshot trigger.
- Survey-submit flow still rewards correctly under `per_run` if shop hasn't been counted yet.
- Notification webhooks (claim success/duplicate/failed) still fire.
