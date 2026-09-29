# Identity Foundation — Stage 1 (identity + S&A foundation)

Branch `security/identity-foundation-finalization` (base `origin/main` `ae823488`). Companion to
`IDENTITY_SA_FOUNDATION_PHASE_A_AUDIT.md`.

Canonical rule: **one human = one central identity**. `auth.users.id = public.users.id` is the only identity
key; email and phone are login aliases and resolution keys.

## Migrations (management executes; nothing was run on staging or production)

Run **in this order**, each file as a whole (they are idempotent and safe to re-run; autocommit-safe — no
session temp tables or session settings across statements):

| # | File | Purpose | Risk | Rollback |
|---|---|---|---|---|
| 1 | `supabase/migrations/20260929100000_sa_decisions_history_survives_user_deletion.sql` | Drops the `sa_authorization_decisions.actor_id → users` FK (ON DELETE SET NULL on an append-only table made every user deletion fail). Generic: any FK from an append-only S&A table to users. Append-only / no-truncate / audit-class triggers unchanged. | Low (constraint drop only) | Header: re-add the FK (restores the defect). |
| 2 | `supabase/migrations/20260929110000_identity_foundation.sql` | `principal_type` (derived), `account_status` (INVITED/ACTIVE/SUSPENDED/DISABLED/ARCHIVED ⇔ `is_active`), `email_normalized`; strict normalizers; `identity_conflicts` (append-only); `identity_resolve`, `identity_provision`, `identity_set_account_status`, `identity_admin_update_access`, legacy-role ceiling; 4 identity permissions (SHADOW) + readiness + `identity-administrator` template; lifecycle trigger re-created to also fire on status/principal. | Medium: adds a stored generated column (short `ACCESS EXCLUSIVE` table rewrite of `public.users`, ~1.7k rows on staging); backfill of the two new columns only (`updated_at` not bumped). | Header: drop triggers/functions/table/columns/constraints in reverse order; re-create `sa_users_lifecycle` with the Final Wave column list. |
| 3 | `supabase/migrations/20260929120000_identity_protected_fields_guard.sql` | API roles (anon/authenticated) can no longer change identity/access/lifecycle columns on any `users` row, nor insert/delete identities. `identity_history_references` + `users_history_delete_guard`: an identity referenced by business/audit history (54 cascading FKs incl. `stock_movements`, `stock_transfers`) can no longer be hard-deleted by the server or by GoTrue — archive instead. | Medium: any undiscovered browser write to a protected column now fails with `identity_protected_field` (all known writers were moved to server actions in this branch). | Header: drop the two triggers and three functions. |

Post-conditions are asserted inside each file (the file fails if they do not hold).

### Required order with the application

Deploy the **application from this branch together with (or after) the migrations** on staging:
- the new server actions call the new RPCs (`identity_*`), and
- migration 3 blocks the old browser writes (`is_active` toggle, consumer dialog) that this branch replaced.

The old application keeps working against migrations 1–2 alone; migration 3 needs this branch's application.

### Staging post-run checks (read-only)

```sql
BEGIN; SET TRANSACTION READ ONLY;
select principal_type, account_status, count(*) from public.users group by 1,2 order by 1,2;
select mode, count(*) from public.sa_migration_modes group by 1 order by 1;          -- expect +4 SHADOW
select count(*) from pg_constraint where conrelid = 'public.sa_authorization_decisions'::regclass
  and contype = 'f' and confrelid = 'public.users'::regclass;                        -- expect 0
select tgname from pg_trigger where tgrelid = 'public.users'::regclass and not tgisinternal order by 1;
ROLLBACK;
```
Full aggregate audit: `supabase/diagnostics/identity_foundation_readonly_audit.sql`.

### Staging certification steps after deployment (UAT, QA-prefixed records)

1. User Management → Add User: new person (created); same email again (kept existing, no duplicate);
   email of person A + phone of person B (blocked, conflict recorded); no Banking step.
2. HR → Add employee: creates/reuses the identity; HR manager requesting a privileged role is refused.
3. Toggle active / deactivate from User Management (server action).
4. Consumer detail edit (Consumer Activations) saves through the server.
5. Delete a user with orders/stock history → archived, not deleted.
6. Security & Access → Roles & Policies shows the four `platform.identity*` permissions (SHADOW). To certify
   NEW_ENFORCED on staging, assign `identity-administrator` / `security-administrator` to the administrators
   first, then switch modes through `sa_set_migration_mode` (readiness is registered for view / disable /
   identity_access.manage).

## Stage 1 closure (management decision 2026-09-28)

| # | File | Purpose | Risk | Rollback |
|---|---|---|---|---|
| 4 | `supabase/migrations/20260929140000_identity_stage1_closure.sql` | (1) `sa_actor_is_staff` = INTERNAL_EMPLOYEE + active account + active S&A membership + non-baseline S&A assignment; legacy level only a narrowing ceiling (staging: 37 internal users keep staff; 3 store consumers and 5 shop-style USER accounts lose it). (2) `sa_actor_is_supply_partner` keeps manufacturer/distributor reads on the six QR/stock read policies (read-only; nothing widened). (3) HR/department onboarding gets the no-authority legacy code GUEST + employee-self-service baseline (never USER, never "staff"). (4) `audit_action_valid` adds `PASSWORD_RESET` and `BULK_ENABLE_STOCK_CONFIGURATIONS` (both were rejected). | Medium: legacy-mode RLS/trigger decisions that used `sa_actor_is_staff` now require the canonical staff identity. **Production prerequisite:** every active portal user must have an active S&A membership and assignment (lifecycle backfill) before this runs there. | Header of the file. |

Numbered 140000 because staging already carries `20260929130000_consumer_reward_secure_ledger.sql`.
The application change (canonical staff test in settings/finance gates, email/SMS monitors, Ellbow/RoadTour
catalog evaluators) is deployed with this branch; it does not depend on 140000.

### Staging UAT (run by management after 140000)

`supabase/diagnostics/identity_stage1_staging_uat.sql` — one DO block, staging only. Creates disposable
`qa-idf-<run>-*@serapod.test` identities (no password, cannot sign in) and exercises cases A–I through the same
database functions the provisioning service calls; each case writes an evidence row to `sa_access_change_log`
(`action = 'uat.identity_stage1'`, `entity_id` = case, `details.pass`). Rehearsed on replicas of current staging in
both staging state (NEW_ENFORCED, read-only) and production-like state: 9/9 cases pass; without 140000 the
A/I/G cases fail (negative control).

## Evidence

- Local vanilla PostgreSQL 17 replica built from a schema-only dump of live staging (catalog counts equal to
  staging: 913 policies, 813 functions, 263 triggers, 452 relations) + S&A catalog rows; production-like state
  (all SHADOW, legacy store writable) and staging state (83/11/3, read-only) both exercised.
- `supabase/tests/security/identity_foundation/*.sql`: **202 checks pass** (resolution matrix, provisioning,
  lifecycle/access, protected fields via PostgREST simulation, audit history). Negative controls: without
  migration 3 an HQ admin changes another user's `role_code` through the API; without migration 1 deleting a user
  with a decision fails with `authorization_decisions_are_append_only`.
- Existing suites unchanged after Stage 1: Final Wave (170), Wave 1 readiness (137), Phase 0B (176).
- Migrations applied twice (idempotent) on both states, in autocommit mode.

## Stage 2 scope (not in this branch)

Provisioning UX (Identity → Organization → Initial Access → Review, invitations instead of admin-set passwords,
INVITED → ACTIVE on first sign-in); HR `hr_employees` as the employment source of truth (remove duplicated HR
columns from the identity row); consumer signup and bulk imports through the resolver; identity-conflict and
identifier-drift remediation (18 non-canonical emails, 17/26 profile↔login drifts, 1 shared phone group,
5 auth-only identities, 1 consumer in RBAC, 3 store users with business roles, 2 HR org mismatches) followed by
normalized-email and verified-phone uniqueness; SUSPENDED that preserves access for restore; archive with
PII minimisation (the OTP route currently releases identifiers, which lets a person get a second identity);
Settings → Authorization read-only redirect; convert the remaining class-A legacy decisions; payee/banking
domain; OTP-verified phone change.
