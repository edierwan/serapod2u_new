# Phone Normalization Hardening

## Canonical contract

- Internal storage format: E.164 with leading plus, for example `+60123456789`
- Provider format: digits only, for example `60123456789`
- Provider conversion is allowed only at outbound WhatsApp adapter boundaries

## Root cause

- The repo had multiple incompatible normalizers returning different shapes: `+601...`, `601...`, and local `01...`
- SQL lookup functions compensated for mixed formats instead of enforcing one canonical format
- App routes, import flows, notification jobs, Moltbot, and Baileys each had local phone munging logic
- Live staging, preprod, and production data already contained mixed persisted formats and at least one normalized duplicate in `users.phone`

## Hardening implemented

- Added shared phone helpers in `shared/phone/index.js`
- Rewired app utilities to the shared module so `normalizePhone()` now returns canonical E.164
- Moved provider conversion to explicit `toProviderPhone(...)` usage in app auth, notifications, support senders, Moltbot, and Baileys
- Normalized referral and admin WhatsApp write paths to canonical E.164
- Updated User Management Reference rendering to resolve the referred user by normalized phone and render name plus phone
- Added migration `supabase/migrations/20260416_phone_normalization_hardening.sql` to:
  - backfill mixed data to canonical E.164
  - normalize phone-bearing columns on insert and update with triggers
  - rewrite SQL lookup functions to compare normalized values
  - add E.164 check constraints on high-risk phone columns
  - expose `public.phone_normalization_collision_report` for duplicate review

## Remaining operational step

- Apply the migration in each environment and review `public.phone_normalization_collision_report` before adding any new unique index on normalized user phone values