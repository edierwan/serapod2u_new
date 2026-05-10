# RoadTour Settings Simplification — 2026-05-10

## Why
RoadTour exists in staging/production but has not been used for a real campaign
yet. The current Settings page exposes too many technical knobs (QR mode,
duplicate reward rule, official visit rule, four validation toggles). For the
first production rollout we want operators to land on a clean page and the
platform to enforce known-safe defaults.

## What was removed from the UI
The simplified `RoadtourSettingsView` (`app/src/modules/roadtour/components/RoadtourSettingsView.tsx`)
no longer renders editable controls for:

- **QR & Duplicate Rules** card
  - QR Mode dropdown
  - QR Expiry (Hours) input
  - Duplicate Reward Rule dropdown
  - Official Visit Rule dropdown
- **Validation & Delivery** card
  - Require Logged-In User toggle
  - Require Shop Context toggle
  - Capture Geolocation toggle
  - WhatsApp QR Delivery toggle
- The amber **Preview Summary** narration card (replaced by a richer system
  status card).

## What stays operator-editable
- **Enable RoadTour Program** master switch (`is_enabled`).
- **Claim WhatsApp Alerts** block: enable, recipient mode (manual / hq_org),
  manual numbers, success template, failure template, test send buttons.

## What is now read-only
A new **System Status** card lists locked defaults as status badges:

| Field | Locked value |
| --- | --- |
| RoadTour Program | Active / Inactive |
| System Defaults | Enabled |
| WhatsApp Delivery | Ready / Not configured / Session issue |
| Geolocation Capture | Enabled |
| Secure Claim Mode | Login + Shop Context Required |

## Locked operational defaults
Defined once in `RoadtourSettingsView.tsx` as `ROADTOUR_LOCKED_DEFAULTS` and
enforced on every save:

```ts
qr_mode               = 'persistent'
duplicate_rule_reward = 'one_per_user_per_campaign'
official_visit_rule   = 'one_per_shop_per_am_per_day'
require_login         = true
require_shop_context  = true
require_geolocation   = true
whatsapp_send_enabled = true
```

These match the existing CHECK constraint values in
`supabase/migrations/20260408_roadtour.sql` for the `roadtour_settings`
table — no enum changes were made.

## Server-side enforcement
- `RoadtourSettingsView.handleSave` now writes the locked values regardless of
  any stale state, ensuring the saved row always matches the locked policy.
- `roadtour_settings` columns kept; nothing dropped.
- New endpoint **`GET /api/roadtour/settings-status`** returns a lightweight
  readiness JSON used by the simplified UI:
  - `roadtour.enabled`, `roadtour.system_defaults`
  - `whatsapp.send_enabled_flag`, `whatsapp.status` (`ready` / `not_configured`
    / `session_issue`), `whatsapp.error`
  - `geolocation.status`, `secure_claim.status`
  - `locked_defaults` echo for client transparency

## DB defaults / migration
A scoped, idempotent SQL script has been added but **not** run:

`docs/roadtourmodules/sql/roadtour-settings-fixed-defaults.sql`

The script:
1. `ALTER TABLE public.roadtour_settings ALTER COLUMN ... SET DEFAULT` for the
   seven locked columns so future inserts match the policy at the DB level.
2. `UPDATE` existing rows to align with the locked policy. Only fields that
   actually differ are updated to minimise churn.

The script is wrapped in a `BEGIN/COMMIT` transaction, scoped strictly to
`public.roadtour_settings`, and does not touch enums, constraints, or any
other table.

DB has **not** been changed. Apply manually on staging first via `psql` or
Supabase Studio when ready.

## Geolocation behaviour check
`require_geolocation` is read in `app/src/lib/roadtour/server.ts` and surfaced
through `validate_roadtour_qr_token`, but `claim-reward/route.ts` does not
hard-block customer claim flows when GPS is unavailable. Today the behaviour
matches the desired policy:

- Visit/scan flows attempt geolocation capture and store
  `location_status` / `location_error` if unavailable.
- Customer QR claim does not fail solely because GPS permission is denied.

No behaviour change was needed for this rollout.

## WhatsApp delivery behaviour check
`whatsapp_send_enabled` is locked to `true`, but real send attempts remain
gated by `getWhatsAppConfig(orgId)` in
`app/src/app/api/settings/whatsapp/_utils.ts`:

- If the gateway/api key is missing, send routes return a clear error
  (`WhatsApp gateway not configured`) instead of crashing.
- The Settings page now surfaces a readiness pill (`Not configured` /
  `Session issue` / `Ready`) so the operator knows the gateway state without
  having to scan Vault logs.
- Campaign creation does **not** depend on WhatsApp; QR rows are still
  generated even when the gateway is unhealthy.

## Files changed
- `app/src/modules/roadtour/components/RoadtourSettingsView.tsx` — rewritten;
  removed editable QR & validation blocks, added System Status card and
  locked-defaults enforcement on save.
- `app/src/modules/roadtour/components/RoadtourCampaignsView.tsx` — new
  3-column Create/Edit Campaign dialog (Campaign Details + Targeting →
  References + Notes → Campaign Summary) with activation readiness signal.
- `app/src/modules/roadtour/components/RoadtourVisitsView.tsx` — rewritten
  Visit Tracking page (header + last-updated, multi-filter bar, 5 KPI cards
  with trend, Visits Over Time / Visits by Region / Top References charts,
  Visit Activity table with Distance from Previous, Outcome, pagination).
- `app/src/app/api/roadtour/settings-status/route.ts` — new read-only
  status endpoint.
- `docs/roadtourmodules/sql/roadtour-settings-fixed-defaults.sql` — new
  migration script (not applied).
- `docs/roadtourmodules/14-settings-simplification.md` — this document.

## Risk register
- **Hidden defaults drift**: Operators can no longer change QR / validation
  rules from the UI. If a campaign needs an exception, only the platform team
  can re-open these via direct DB edit.
- **WhatsApp readiness probe**: `/api/roadtour/settings-status` calls the
  gateway's `/health` endpoint. Some gateways may return non-standard
  responses; the probe is defensive but a healthy gateway with an unusual
  payload could show `Session issue`. This is informational only and does not
  block any flow.
- **Trend cards** in the new Visit Tracking page compare the current window
  vs the immediately preceding equal-length window. The previous window is
  loaded from the same in-memory list, so when the date filter is set very
  tight the trend may show no value (intentional, no fabricated %).

## Tests
- TypeScript: `npm run --prefix app typecheck` (see commit log for output).
- Build:      `npm run --prefix app build`.
- Lint:       `npm run --prefix app lint`.

## Manual test checklist
- [ ] Settings page: no QR / validation dropdowns or toggles visible.
- [ ] Settings page: status pills render and reflect actual state.
- [ ] Save Settings: writes locked defaults regardless of prior values.
- [ ] Create Campaign: 3-column dialog renders, summary updates as form
      changes, "Ready to activate" lights up green when all required fields
      are filled.
- [ ] Campaign create still works end-to-end and persists `qr_mode='persistent'`.
- [ ] Duplicate claim is still blocked by RPC `record_roadtour_reward`.
- [ ] Official visit rule still blocks duplicate AM/shop/day visits.
- [ ] Visit Tracking: filters, pagination, charts, distance, KPI trends.
- [ ] Visit Tracking: Export CSV downloads with current filter applied.
- [ ] WhatsApp delivery: campaign creation works even when gateway is down;
      Settings page shows "Not configured" / "Session issue" pill correctly.

## Final summary
1. **Files changed**: 5 application files + 1 new SQL + 1 new doc (this file).
2. **Database changed?** No.
3. **Migration / SQL file created?** Yes, scoped & not applied:
   `docs/roadtourmodules/sql/roadtour-settings-fixed-defaults.sql`.
4. **Locked defaults**: see `ROADTOUR_LOCKED_DEFAULTS` block above.
5. **Risks**: hidden defaults drift, WA probe edge cases, trend cards on
   short windows. None block rollout.
6. **Commands run**: typecheck / build / lint — see commit message and
   terminal log.
