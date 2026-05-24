# RoadTour Settings Tab Layout

## Current Issue

The RoadTour Settings page had grown into one long mixed screen that combined system status, informational notices, claim WhatsApp alert controls, templates, test actions, and the save action in a single scroll path. That made the page harder to scan and made the save action feel disconnected from the fields being edited.

## New Tab Structure

Two tabs now organize the existing settings surface without changing the stored data model:

1. `System Status`
2. `Claim WhatsApp Alerts`

The page title and intro remain above the tabs. The default active tab is `System Status`.

## Sections Moved To System Status Tab

- Enable RoadTour Program
- System Status card
- QR mode / duplicate reward / official visit system-locked notice
- Duplicate Protection notice
- Existing program, delivery, secure claim, and geolocation status indicators
- Save RoadTour Settings button remains available here because save still applies globally

## Sections Moved To Claim WhatsApp Alerts Tab

- Claim WhatsApp Alerts card
- Enable Claim Alerts toggle
- Recipient Mode
- Manual Recipient Numbers
- Test Success button
- Test Failure button
- Success Template
- Failure Template
- Available variables note
- Save RoadTour Settings button remains available here because these are the primary editable operator fields

## Files Changed

- `app/src/modules/roadtour/components/RoadtourSettingsView.tsx`
- `app/src/modules/roadtour/components/RoadtourSettingsView.test.tsx`
- `docs/roadtourmodules/25-roadtour-settings-tab-layout.md`

## Save Behavior

- No API, SQL, or schema changes were introduced.
- Save still calls the existing `handleSave` logic and writes the same `roadtour_settings` payload shape.
- Form state is still held in React state, so tab switches do not discard unsaved edits.
- Test Success and Test Failure still call the existing RoadTour claim alert test endpoint.

## No SQL / Migration Confirmation

- No SQL added
- No Supabase migration added
- No schema change made
- No RoadTour reward, claim, duplicate protection, or WhatsApp gateway logic changed

## Staging Test Checklist

1. Open `Customer & Growth > RoadTour > Settings`.
2. Confirm two tabs are visible: `System Status` and `Claim WhatsApp Alerts`.
3. Confirm `System Status` is active by default.
4. Confirm `System Status` shows the enable card, status card, locked notices, and duplicate protection notice.
5. Click `Claim WhatsApp Alerts`.
6. Confirm it shows the claim alert toggle, recipient mode, manual numbers, test buttons, templates, variables note, and save button.
7. Edit manual numbers, switch tabs, switch back, and confirm the unsaved values remain.
8. Click `Test Success` and `Test Failure` and confirm the existing behavior still works.
9. Click `Save RoadTour Settings` and confirm the save succeeds.
10. Reload the page and confirm saved values persist.
11. Confirm RoadTour campaigns, analytics, and claim flows are unchanged.