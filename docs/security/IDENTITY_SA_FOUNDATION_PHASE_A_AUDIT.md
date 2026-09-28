# Serapod2u — Identity + S&A Foundation Finalization
## Phase A: Canonical Identity + Authorization Write-Path Audit

Date: 2026-09-28 · Scope: discovery only (no data changed). Revision 2 (same day): staging evidence re-verified by direct read-only SQL (`BEGIN; SET TRANSACTION READ ONLY; … ROLLBACK`, aggregates only); production section pending access (see §K2).

---

## 0. Source control

| Item | Value |
|---|---|
| `origin/main` (fetched) | `ae823488` "fix: keep DH receipts when the private attachment upload fails". This matches the expected baseline. |
| New branch | `security/identity-foundation-finalization` |
| Actual base SHA | `ae82348836264071fb446200220ba56da25a711d` (= origin/main) |
| Upstream | unset on purpose, so a plain `git push` cannot target `main` |
| Commits on branch | none (Phase A makes no changes) |
| Staging vs main | `origin/staging` is 135 commits ahead of main. Not merged. |

The audit was read from a separate worktree of the new branch, so the user's current checkout (`integration/consumer-shop-linking-staging`, which has 4 untracked migrations) was not touched.

### Evidence sources and their limits

| Source | Access | Notes |
|---|---|---|
| Code (main @ ae823488) | full | All code findings cite main. |
| Staging DB | **direct read-only SQL** (`serapod-stg-db` on KVM2 via `~/.ssh/serapod_migration`), every statement inside `BEGIN; SET TRANSACTION READ ONLY; … ROLLBACK;` | Catalog + aggregate queries only; no `SET ROLE` probes on the live database. Schema-only `pg_dump` (public, storage, auth) used to build a local vanilla PG17 replica for certification; its catalog counts match live staging exactly (913 policies, 813 functions, 263 triggers, 452 relations). |
| Staging PII | **never output** | Duplicate/drift checks run as aggregates inside the database; only counts and 8-character UUID prefixes are reported. |
| Production DB | **not yet read** | Management authorized read-only access, but the session's tool policy refused the production connection (read-only transaction included). §K2 lists the exact aggregate SQL; nothing in this report asserts production values. |
---

## A. Current identity architecture

```
auth.users (GoTrue)            1 row per login; email (lowercased by GoTrue), phone (unique in GoTrue)
   │ 1:1, public.users.id FK → auth.users(id) ON DELETE CASCADE   (users_id_fkey)
   ▼
public.users                   THE de-facto central identity AND the legacy authorization record
   ├─ identity:    id, email (UNIQUE, case-SENSITIVE), phone (E.164 CHECK, NOT unique), full_name, call_name
   ├─ verification: is_verified, email_verified_at, phone_verified_at
   ├─ lifecycle:   is_active (bool), employment_status (text), active_session_id
   ├─ principal:   account_scope ('portal' | 'store'), auth_provider
   ├─ org:         organization_id (single; FK organizations)
   ├─ legacy authz: role_code (FK roles) → roles.role_level (1/10/20/30/40/50), roles.permissions (jsonb)
   ├─ HR fields:   department_id, position_id, manager_user_id, employment_type, join_date, employee_no
   ├─ banking:     bank_id, bank_account_number, bank_account_holder_name
   └─ consumer:    shop_name, referral_phone, address, location, consumer_claim_confirmed_at, can_be_reference
        │
        │ trigger sa_users_lifecycle (AFTER INSERT/UPDATE OF is_active, employment_status,
        │ organization_id, role_code, account_scope, employment_type)
        ▼
S&A (Final Wave, 20260928100000–180000)
   sa_organization_memberships  (multi-membership capable; lifecycle derives exactly 1 primary)
   sa_role_assignments → sa_business_roles → sa_business_role_permissions → sa_permissions
   sa_assignment_scopes → sa_scope_definitions (org / warehouse / own_record / …)
   sa_migration_modes (per permission: LEGACY_ENFORCED | SHADOW | NEW_ENFORCED | LEGACY_RETIRED)
   sa_authorization_decisions, sa_access_change_log, sa_sod_violations (append-only)
   sa_service_identities (non-human registry; metadata only)

hr_employees  (id, employee_no, user_id FK users, organization_id, hire_date, probation_end, status)
```

**Key architectural facts**

1. **There is already one immutable identity key.** `auth.users.id = public.users.id`, a UUID, and every module FK points at it. Email and phone are not keys. This is the correct base; no new identity table is needed.
2. **`public.users` mixes five concerns**: identity, legacy authorization (`role_code`), org placement, HR employment, and banking/consumer profile.
3. **S&A is derived from `public.users`.** `sa_sync_user_lifecycle()` (20260928110000:652) creates the membership and a *compatibility business role* from `users.role_code`. So `role_code` is still a live **authorization write path** whenever `legacy_authorization.read_only = false`: changing it grants the `legacy-<role>` compat role. When the switch is true (as on staging), a role_code change can only *remove* compat access.
4. **The enterprise vs consumer boundary is `account_scope`.** `portal` + organization_id → enterprise (S&A membership). `store` → consumer (never gets S&A). The lifecycle keys on exactly this.
5. **Service identities are separate from humans.** `sa_service_identities` is a metadata registry (18 on staging). Workers authenticate with CRON_SECRET / service-role key, not with auth.users rows.

---

## B. Every identity creation / write path

Legend: **C** canonical · **L** legacy · **D** duplicate. Action: KEEP / MODIFY / RETIRE.

### B1. Creating identities (auth.users and/or public.users)

| # | Path / function | Data written | Caller / persona | Current authorization | Class | Action |
|---|---|---|---|---|---|---|
| 1 | `lib/actions.ts:58` `createUserWithAuth` | auth.users (email, password, phone, email_confirm=true) → `sync_user_profile` → users (role_code, org, scope, HR fields, **banking**, can_be_reference) → Cellera loyalty membership | User Management → Add User wizard (`UserDialogNew.tsx`) / HQ admin | `userAllowed('platform.user.manage', legacy: create_users OR role_level≤30, org = target org)` | C (best current) | **MODIFY** → becomes the single provisioning service (identity resolution + S&A initial role) |
| 2 | `lib/actions/departments.ts:1099` `createUserForDepartment` | auth.users + users (**any role_code**, dept org, scope portal, dept, manager); returns tempPassword to the browser | Settings → Departments → Add user | **Legacy only**: `role_level ≤ 20 OR HR_MANAGER` (`:629`). No S&A, and no ceiling on the role_code it may assign | D | **RETIRE** (route to #1). Privilege-escalation risk: an HR_MANAGER can mint an `SA` user. |
| 3 | `app/api/hr/employees/route.ts` POST, `create_login=true` | auth.users + users (role_code default `'staff'`, caller org) + HR fields; returns temp_password | HR → People → "Create New" | `hrCan('hr.employee.manage', legacy role_level≤20)` | D | **RETIRE** create branch → call #1 |
| 4 | same, `create_login=false` (`:261`) | `public.users` insert with `crypto.randomUUID()` and **no auth.users** | HR → "Create New" without login | same | D, **broken** | **RETIRE**. It violates `users_id_fkey → auth.users` (fails every time). The default `role_code='staff'` (`:151`) is not in `roles`, so it also violates `users_role_code_fkey`. |
| 5 | `lib/actions.ts:776` `registerConsumer` | auth.users (normalized email lowercased, phone) → `sync_user_profile(GUEST)` → users (org / shop link, referral, etc.) + shop creation + loyalty memberships | Public consumer / shop signup | OTP verification token; service-role | C (consumer) | **MODIFY** → consumer branch of the resolution service |
| 6 | `components/auth/SignupPageClient.tsx:134` `signInWithOtp` | GoTrue OTP (may create auth.users) | Public | GoTrue | C | KEEP (verification channel) |
| 7 | `server/auth/ensureUserRow.ts` | users row for any authenticated session missing one; `account_scope='portal'` if the email domain is serapod.com / serapod2u.com, else `store` | Post-login redirect, OAuth callback | none (system) | C (repair) | **MODIFY**. Must never infer *portal* from an email domain; it should create a `store`/pending row only. |
| 8 | `handle_new_user()` trigger fn (baseline) | users(id, email, GUEST) ON CONFLICT DO NOTHING | auth insert (if the trigger is attached) | system | L | Verify attachment (Appendix 1 Q1). KEEP as a safety net, or RETIRE in favour of #7. |
| 9 | `sync_user_profile` RPC (Phase 0A, service_role only) | users upsert (email, role_code, org, scope, active, verified) | #1–#5 | service_role | C (internal) | **MODIFY** → internal step of the resolution service; remove role_code authority |
| 10 | `app/api/admin/point-migration{,-stream}/route.ts` | bulk auth.users + users + points | Admin import | `guardUserOperation('customer.loyalty.adjust', legacy role_level≤20)` | D | **MODIFY** → must use the resolution service (bulk import is the #1 source of duplicate identities) |
| 11 | `components/setup/DatabaseSetup.tsx` upsert users | users upsert from the browser | setup page | RLS | L / dead | **RETIRE** |
| 12 | `components/setup/AuthDiagnostic.tsx:101` `auth.signUp` | auth.users | diagnostic page | none | L / dead | **RETIRE** |
| 13 | `lib/actions.ts:596` `signup(formData)` | `auth.signUp` | legacy form | none | L | **RETIRE** (verify no caller) |

### B2. Updating identity fields

| Path | Fields | Persona | Authorization | Class | Action |
|---|---|---|---|---|---|
| `lib/actions.ts:252` `updateUserWithAuth` | full_name → auth metadata; phone → auth.users + users; **role_code, organization_id, is_active, account_scope** (auto), HR fields, banking, signature, can_be_reference | User Mgmt Edit (other) / self | other: `platform.user.manage` scoped to the target's **current** org, legacy `edit_users OR role_level≤30`. Self: field allow-list (`user-profile-updates.ts`) | C | **MODIFY**. Split identity/profile edits from access edits. role_code/org changes must go through S&A provisioning, and the *destination* org must be authorized too (today only the source org is checked). |
| `api/user/update-profile` | name, phone (auth + users) | self | session + legacy `isAdmin` shortcut | C | MODIFY (merge into the identity service) |
| `api/user/update-phone` | users.phone only | self | session | D | **MODIFY/RETIRE**. It writes `public.users.phone` without auth.users, so login phone and profile phone drift. |
| `components/dashboard/views/MyProfileView*.tsx` | users (self) via browser | self | RLS `users_update_own` + Phase 0A trigger | L | MODIFY. Phone is **not** in the Phase 0A protected list, so a browser self-edit changes the profile phone without verification. |
| `components/users/UserManagementNew.tsx:1162` | `is_active` toggle via browser | admin | RLS `users_admin_all` (gated) | L | **MODIFY** → server action (lifecycle state change) |
| `components/users/UserManagement.tsx:315` | users `.delete()` via browser | admin | RLS | L / old UI | **RETIRE** (old view) |
| `components/settings/DepartmentsTab.tsx` | dept/manager on users | HR admin | RLS | D | MODIFY → HR employment API |
| `components/dashboard/views/consumer-engagement/ConsumerActivationsView.tsx` | users update (consumer) | admin | RLS | L | MODIFY → server route |
| `components/hr/HrPeopleView.tsx`, `MyProfileView`, `UserManagement` | avatar_url | self/admin | RLS | C | KEEP |
| `api/users/[id]/hr`, `api/hr/employees/profile` (PUT/POST "Link Existing") | users.department/position/manager/employment_*/join_date/**employee_no** | HR | `hrCan('hr.employee.manage')` + legacy cross-org role_level≤20 | D (HR data on the identity row) | **MODIFY** → write `hr_employees` (employment record), not users |
| `api/users/reset-password`, `api/auth/password-reset/complete` | auth password | admin / self | `platform.user.manage` / token | C | KEEP |
| `api/update-login-ip`, `LoginForm`, `LoginPageClient`, `auth/callback` | last_login_at/ip, auth_provider | self / system | session | C (telemetry) | KEEP (move to server) |
| `lib/consumer/shop-link.ts:141` `linkConsumerShop` (`:177`) | users.organization_id (consumer → SHOP org) | consumer / admin | caller-level; service role | C (consumer) | KEEP, but it must never set account_scope=portal |
| `api/shops/create` | users (org link after shop creation) | consumer / admin | session | C (consumer) | KEEP / verify |
| `api/admin/user-shop-migration` | users.organization_id bulk set/clear | admin | `customer.shop.manage` | C | KEEP |
| `api/consumer/collect-points{,-auth}`, `api/roadtour/claim-reward`, `PremiumLoyaltyTemplate` | consumer profile fields / auth.updateUser (password) | consumer | session / OTP | C (consumer) | KEEP |

### B3. Deleting / disabling identities

| Path | Behaviour | Authorization | Action |
|---|---|---|---|
| `lib/actions.ts:616` `deleteUserWithAuth` | public + auth hard delete | `platform.user.manage` / `delete_users` | **MODIFY** → ARCHIVE (see §4) |
| `api/admin/delete-user-otp/{request,verify-and-delete}` | OTP-confirmed hard delete (`auth.admin.deleteUser`) | bare `guardUserOperation('platform.data.destructive')`, then inline role_level≤10 | MODIFY → archive. Hard delete is blocked anyway by the defect in §I. |
| `api/admin/bulk-delete-users` | bulk auth delete | `assertDestructiveOpsAllowed` | **RETIRE** in prod (keep only as a guarded staging tool) |
| `api/admin/delete-all-data` | wipes data incl. auth users | `assertDestructiveOpsAllowed` | staging-only; KEEP guarded |
| Browser `is_active` toggles | disable | RLS | MODIFY → lifecycle API |

**Service identities:** created by migrations only (`sa_service_identities` seed); heartbeat via `sa_touch_service_identity`. No runtime creation path exists. **KEEP.**

---

## C. Every authorization write path

| Store | Writer | Persona | Authorization | Class | Action |
|---|---|---|---|---|---|
| `sa_role_assignments` (manual) | `sa_assign_role` / `sa_revoke_assignment` ← `/api/security-access/assignments` | S&A admin | `security.role.assign` in the target org, no self-assignment, reason ≥5 chars, SoD, scope ⊆ membership | **C** | KEEP |
| `sa_role_assignments` / `sa_organization_memberships` (derived) | `sa_sync_user_lifecycle` via trigger `sa_users_lifecycle` on users; `sa_lifecycle_resync_all` (cron `sa-governance-maintenance`) | system (JML) | none (trigger) — driven by whoever can write users.role_code / org / scope / is_active | **C mechanism, L input** | **MODIFY**. The membership input should come from the provisioning service, not from raw `users.role_code`. |
| `sa_business_roles` / permissions | `sa_save_business_role` ← `/api/security-access/roles` | S&A admin | RPC internal | C | KEEP |
| `sa_scope_definitions` | `sa_define_scope`; `sa_ensure_scope_internal` (lifecycle) | admin / system | RPC | C | KEEP |
| `sa_delegations`, `sa_access_requests`, reviews, SoD mitigations, emergency | respective `sa_*` RPCs ← `/api/security-access/*` | admins / requesters | RPC | C | KEEP |
| `sa_migration_modes` | `sa_set_migration_mode` ← `/api/security-access/modes` | S&A admin | RPC + readiness registry | C | KEEP (production: no changes) |
| `sa_settings` (`legacy_authorization.read_only`) | `sa_settings_guard`; set by migration / admin | admin | guard | C | KEEP |
| **`users.role_code`** | #1, #2, #3, #9, `updateUserWithAuth`, **browser via RLS `users_admin_all`** | User Mgmt / HR / Departments | mixed; #2 legacy-only | **L (active escalation path while read_only=false)** | **MODIFY**. Freeze to a server-only "provisioning preset"; block it in RLS / column grants. |
| **`users.organization_id` / `account_scope`** | same + consumer shop link + shop migration | same | mixed | L | MODIFY (membership-driven) |
| `roles.permissions` / `roles.role_level` | `lib/actions/authorization.ts:152` `saveRolePermissions` ← Settings → Authorization | SA admin | `manage_authorization` (legacy) + read-only switch (app + DB trigger `sa_legacy_store_read_only`) | L | RETIRE writes (→ read-only view) |
| `departments.permission_overrides` | `updateDepartmentPermissionOverrides` (`:99`) | same | same; clearing always allowed | L | RETIRE writes |
| `hr_access_groups*`, `hr_permissions` | HR settings (`/api/hr/settings/permissions`, `lib/server/hr/seedPermissions.ts`) | HR admin | legacy role_level≤20 + DB read-only trigger | L | RETIRE (staging: 0 group members) |
| Finance role matrix | `FinancePermissionsSettings.tsx` | — | already a read-only pointer to S&A | done | KEEP (pointer) |
| `loyalty_program_user_memberships` | `upsertUserProgramMembership` | system | — | consumer / program relation, **not RBAC** | KEEP (outside S&A) |

---

## D. Legacy `role_level` / `role_code` dependency map

Method: a per-file scan of `app/src` (non-test, 347 files referencing role_level, role_code, or legacy permission stores), then reclassified by whether the decision feeds an S&A evaluator. Raw map: `legacy_map2.tsv`.

| Class | Files | Meaning |
|---|---|---|
| **B. COMPATIBILITY ONLY** (legacy evaluator inside an S&A guard) | **~115** | `financeAllowed/hrCan/userAllowed/guardUserOperation(…, legacy)`. The mode decides; in NEW_ENFORCED / LEGACY_RETIRED the legacy value is diagnostic only. Includes all `/api/accounting/*`, all HR routes using `hrCan`, supply chain, orders, WMS. |
| **C. REPORTING / DISPLAY / PROPAGATION** | ~142 | Selecting role_code/role_level for display, types, labels, or passing context. |
| **A-ui. CLIENT UI GATING** | 58 | `.tsx` menus/tabs using role_level (`usePermissions`, sidebar visibility). Not a security boundary, but they diverge from S&A (a user may see a menu S&A denies, or the reverse). |
| **A. AUTHORIZATION DECISION WITHOUT S&A** (server) | **~20 real** | See below. |
| **D. PROVISIONING PRESET** | 3 | `sa_refresh_compat_role` / `sa_compat_role_key` (DB), `lib/security-access/catalog.ts`, `sa_legacy_compat_rules` (role_code → compat permissions). |
| **E. DEAD** | ≥4 | `UserManagement.tsx` (old), `UserDialogNew.tsx.bak`, `DatabaseSetup.tsx`, `AuthDiagnostic.tsx`, `create_new_user()` (raises "deprecated"). |
| **F. UNKNOWN (DB)** | see DB section | RLS policies / functions using `is_hq_admin()` (178 refs in migrations), `current_user_org_id()` (73), `is_power_user()` (24), `is_super_admin()` (19). How many are wrapped by `sa_rls_gate` needs a catalog query (Appendix 1 Q9). |

**Class A — server-side legacy decisions with no S&A decision (action list)**

| File | Decision | Risk | Action |
|---|---|---|---|
| `lib/actions/departments.ts:629` (`canManageDepartments`, `canManageOrgChart`) incl. `createUserForDepartment` | role_level≤20 OR HR_MANAGER | **High** (creates users with any role) | S&A `hr.organization.manage` + provisioning service |
| `lib/actions/hrPositions.ts`, `lib/actions/hrSettings.ts`, `modules/hr/accounting/actions.ts` | role_level≤20 | Medium (HR not live) | `hrCan` |
| `app/api/orders/[orderId]/access/route.ts`, `app/api/orders/actors/route.ts` | HQ && role_level===10 | Medium (Supply Chain) | wrap in `guardUserOperation('orders.*', legacy)` |
| `app/api/user/update-profile/route.ts` | `isAdmin = SUPER/HQ_ADMIN/role_level…` | Medium | `platform.user.manage` |
| `app/{catalog,crm,ecommerce,marketing,settings}/_lib.ts` | page gating: orgType && role_level ≤ 30/40/50 | Low–Med (page entry; APIs guarded separately) | S&A `*.view` permission |
| `lib/inventory/add-stock-inventory.ts`, `lib/warehouse/shipment-authorization.ts`, `modules/supply-chain/h2m-access.ts` | role_level ≤10/≤40 | Low (used as legacy evaluators by guarded callers; verify each call site) | confirm B |
| `lib/notifications/smsMonitorAccess.ts`, `lib/roadtour/notifications.ts`, `lib/shop-requests/notifications.ts` | recipient selection by role_level≤20 | Low (routing, not access) | reclassify as D (notification routing) → S&A "notify" permission later |
| `lib/server/hr/assistant/policy.ts`, `lib/ai/hrAudit.ts` | AI tool scope by role_level≤10/≤20 | Medium (data exposure through AI) | `hr.*.view` via `hrCan` |
| `lib/server/permissions.ts` | the legacy engine itself (role_level===1 ⇒ all) | — | B (legacy evaluator source); keep until LEGACY_RETIRED everywhere |
| `hooks/usePermissions.ts` | client legacy permission hook | UI | replace with an S&A capability endpoint |

**Structural rule check: "a legacy ALLOW must never override a NEW_ENFORCED DENY"**

- App layer: **holds.** `authoritativeOutcome()` (`lib/security-access/enforcement.ts`) returns the new decision in NEW_ENFORCED / LEGACY_RETIRED. Inline legacy checks placed *after* a guard can only add a deny.
- DB layer: **holds only for gated policies.** `sa_rls_gate(p, org, legacy)` ignores legacy in new mode. **Any policy not rewritten by `sa_gate_policy` still grants on `is_hq_admin()` regardless of S&A mode.** That is exactly a legacy ALLOW that can override a NEW DENY (Appendix 1 Q9 lists them).
- **Caveat for production.** `guardUserOperation(user, perm)` with no `legacy` option defaults the legacy evaluator to `() => true` (`lib/security-access/operation.ts:96`). 233 of 246 call sites are bare. In SHADOW / LEGACY_ENFORCED (production today), those routes authorize with whatever inline legacy check follows the guard. Where no inline check follows, the route is effectively open to any authenticated user. That preserves pre-S&A behaviour, but it must be audited per route before any production NEW_ENFORCED flip, because the parity numbers in shadow will read "legacy ALLOW" for those routes.

---

## E. User Management assessment

**What Add User writes today** (`UserDialogNew.tsx` → `createUserWithAuth`). The wizard actually has **5 steps**: Basic Info · Role & Access · **Business** · Banking · Review.

| Step | Written to | Belongs in |
|---|---|---|
| Basic Info (name, call_name, email, phone, password, avatar) | auth.users + users | **Identity** ✔ |
| Role & Access (role_code, organization_id, is_active, dept, manager, position) | users.role_code/org/is_active/dept/manager/position → trigger → S&A membership + compat role | Org membership ✔; initial S&A role ✔ (but must be an **S&A business role + scope**, not a legacy role_code); dept/manager/position ✘ → HR |
| Business (shop_name, address, referral_phone, can_be_reference, employment_type/status, join_date) | users | consumer/shop profile / HR ✘ |
| Banking (bank_id, account no., holder) | **users** | ✘. This is payee data. Staging: 107 users have a bank account, **only 2 of them portal**, so it is overwhelmingly consumer/shop payout data. Move it to a payee / business profile domain (consumer payout profile; HR employee payroll bank). Encrypt / restrict at rest; it must not live on the identity row. |
| Review | — | ✔ |

It also creates a Cellera loyalty membership for SHOP/DIST org users (a program relationship, not RBAC; fine).

**Gaps.** No identity resolution: it only relies on the GoTrue email uniqueness error; phone duplicates are not checked. The initial authorization is a legacy role_code. Password is set by the admin (no invite). email_confirm and phone_confirm are forced true without verification.

**Target.** User Management = identity registry (identity, contact, lifecycle, principal type, org onboarding). Access assignment is delegated to an embedded S&A "Initial access" step that calls `sa_assign_role`. Banking goes out.

---

## F. HR reset / dependency assessment (HR not live)

**Staging:** 89 `hr_*` relations; **80 empty**. Non-empty: `hr_employees` 36, `hr_public_holidays` 15, `hr_kpi_metrics` 10, `hr_kpi_objectives` 1, `hr_kpi_periods` 1, `hr_kpi_settings` 1, `hr_attendance_policies` 1, `hr_overtime_presets` 1, `hr_employee_dashboard` 1723 (a view over users).

| Class | Tables |
|---|---|
| **SAFE_TO_RESET** | all transactional HR: leave_*, attendance_* (entries/corrections/audit), timesheets, overtime_requests/calculations, payroll_runs/items/audit, payslip_access_logs, expense_claims/items, kpi_* (actuals/assignments/scorecards/reviews/evidence/snapshots/adjustments/audit), performance_reviews, appraisal_cycles, onboarding_instances/tasks/documents, applicants/applications/interviews/offers/job_postings, course_enrollments, certifications, skill_assessments, document_requests, profile_change_requests, benefit_enrollments/contribution_*, employee_allowances/deductions/compensation, hr_gl_postings, hr_employees (rebuild). All empty except hr_employees and the KPI seeds. |
| **MASTER_DATA_KEEP** (review) | hr_public_holidays (15), hr_leave_types, hr_allowance_types, hr_deduction_types, hr_salary_bands, hr_attendance_policies, hr_overtime_policies/rules/presets, hr_shifts, hr_kpi_definitions/metrics/settings, hr_review_templates, hr_onboarding_templates/_tasks, hr_policies, hr_courses, hr_benefit_providers/plans, hr_approval_chains/_steps, hr_settings |
| **SHARED_DEPENDENCY** | `departments` (used by S&A scope `department`, users.department_id, notifications), `hr_positions`, `hr_gl_mappings` / `payroll_component_gl_map` / `payroll_clearing_accounts` (Finance) |
| **IDENTITY_DEPENDENCY** | users.{department_id, position_id, manager_user_id, employment_type, join_date, employment_status, employee_no}. `employment_status` / `employment_type` / `is_active` **drive S&A JML**. `hr_contracts.expiry_date` drives the contractor expiry. |
| **SUPPLY_CHAIN_DEPENDENCY** | none direct; `departments.manager_user_id` is used for approvals (`getNextApprover`) |
| **AUDIT/HISTORY_KEEP** | hr_payroll_audit, hr_attendance_audit, hr_kpi_audit_log (empty on staging); the legacy-read-only stores hr_access_groups / hr_permissions (keep for compat evidence) |

**Does employee → central user_id exist?** Yes. `hr_employees.user_id → public.users(id)` (staging: 36 rows, 0 null, 0 dangling, 0 duplicate users). **But HR data is duplicated in two places:**

| Concept | on `users` | on `hr_employees` |
|---|---|---|
| employee number | `employee_no` (36 set) | `employee_no` |
| start date | `join_date` | `hire_date` |
| status | `employment_status` | `status` |
| organization | `organization_id` | `organization_id` (**2 of 36 disagree with users**) |
| department / position / manager / type | users only | — |

Other staging anomalies: 1 employee's user is `account_scope='store'` (an employee outside enterprise RBAC). `/api/hr/employees` writes employment facts to **users**, not hr_employees. The "Create New" path is broken (§B #3/#4). The "Link Existing User" tab is the admin-facing decision management wants removed.

**Target.** `hr_employees` becomes the sole employment record (`user_id` NOT NULL UNIQUE per org). The users HR columns become a read-only compatibility projection (or are dropped after consumers move). JML reads employment status from hr_employees. HR never creates logins; it calls the provisioning service.

---

## G. Finance reset / dependency assessment (Finance not live)

**Staging rows:** fiscal_years 2, fiscal_periods 24, gl_accounts 6, gl_settings 1, gl_journals 1, gl_journal_lines 3, gl_document_postings 1. Everything else is empty (bank_*, budgets, posting_rules, exchange_rates, currency settings, payroll_* GL maps, tax_codes).

| Class | Tables |
|---|---|
| SAFE_TO_RESET | gl_journals, gl_journal_lines, gl_budgets/_lines, bank_accounts, bank_reconciliations/_lines, exchange_rates, accounting_currency_settings, gl_posting_rules, fiscal_years/periods, gl_accounts (re-seed), gl_settings |
| SHARED_WITH_SUPPLY_CHAIN | `payment_terms` (6; organizations.payment_term_id), `warehouse_receipts` (received_by), `payment_gateway_settings` (e-commerce) → **KEEP** |
| DOCUMENT_DEPENDENCY | `gl_document_postings` (1 row, links documents → GL; `v_documents_gl_status`, `v_pending_gl_postings`). Reset the posting row only; never touch documents. |
| IDENTITY_DEPENDENCY | **every finance actor column is a raw uuid with no FK**: gl_journals.created_by/posted_by, gl_budgets.approved_by, fiscal_*.closed_by, bank_reconciliations.reconciled_by, gl_accounts/gl_settings/*.created_by/updated_by (21 columns). These are good for history survival, but have no integrity check. |
| AUDIT/HISTORY_KEEP | `/api/finance/config/audit`, `destructive_ops_audit_log` |

Finance authorization is already on S&A: `financeAllowed()` for all `/api/accounting/*`, plus `sa_gate_table` on the GL / bank / fiscal tables (20260928110000:337–354). The Finance permission matrix UI is already a pointer to S&A. **No separate Finance identity exists. Keep it that way.**

---

## H. Supply Chain protected dependency map

91 actor columns across 56 supply-chain tables (staging OpenAPI metadata):

- **FK → public.users (66):** orders.created_by/approved_by/updated_by; order_items.stock_config_confirmed_by; stock_movements.created_by; stock_transfers.{created,submitted,approved,dispatched,received,rejected}_by; qr_batches.created_by/excel_generated_by; qr_master_codes.{manufacturer_scanned,shipped,warehouse_received}_by; qr_movements.scanned_by; qr_codes.last_scanned_by; qr_reverse_jobs.*; qr_validation_reports.*; product*/variant_kkm_certificates.*; inventory_opening_cutoffs.*; inventory_cutoff_*.decided_by/excluded_by/actor_id/generated_by; messaging_warehouse_inbox.{received,shipped,ready,prepared_started,partial_accepted}_by; messaging_delivery_*.{acknowledged_by_user_id,reported_by_user_id,resolved_by}; messaging_order_timeline_events.actor_user_id; stock_count_sessions.posted_by/archived_by; stock_count_verification_requests.*; consumer_qr_scans.consumer_id/adjusted_by; redemption_orders.staff_user_id; roadtour_qr_*.account_manager_user_id.
- **Raw uuid, no FK (17):** stock_adjustments.created_by/manufacturer_acknowledged_by; stock_adjustment_manufacturer_actions.created_by; stock_count_sessions.created_by/updated_by; stock_count_classification_allocation_resolutions.created_by; inventory_cutoff_*_requests.created_by (4); qr_batches.production_completed_by; qr_verification_log.recovered_by (→ auth.users per migration 20260404); return_cases.created_by; return_case_status_history.changed_by; return_settings.updated_by; warehouse_receipts.received_by.
- **Text / embedded (8):** messaging_*_channel_user_id (WhatsApp channel ids), return_cases.received_by (**name text**), qr_verification_log.test_actor, vw_stock_movements_ordered.created_by_email.
- JSON: order timeline / notification payloads embed actor ids and names.

**Protection rules.** (1) Never re-key, merge or delete a user referenced here. Hard delete is already blocked by NO ACTION FKs, which is desirable. (2) Identity merge (if ever needed) must be a *tombstone + alias* table (`identity_aliases(old_user_id → canonical_user_id)`), never an UPDATE of history columns. (3) Archiving must keep the users row (name / email for display). (4) No Supply Chain schema changes in this programme.

---

## I. Document / audit dependency map

| Table | Actor columns | Ref type | Survives lifecycle? |
|---|---|---|---|
| documents | created_by, acknowledged_by | FK users | yes, if users rows are archived rather than deleted |
| document_files | uploaded_by | FK users | same |
| document_signatures | signer_user_id | FK users | same (signature images now private: 20260928170000/180000) |
| PAYMENT_REQUEST | is a `documents.document_type`; read boundary 20260928150000 | via documents | same |
| serapp_conversations/messages/order_holds/user_presence | owner/sender/created_by/accepted_by | FK users | same |
| messaging_delivery_discrepancy_attachments | uploaded_by_user_id (+ channel text) | FK + text | same |
| sa_access_change_log | actor_id, target_user_id | **raw (FK dropped by 20260928160000)** | ✔ |
| sa_sod_violations | user_id | **raw (FK dropped)** | ✔ |
| **sa_authorization_decisions** | actor_id | **FK users ON DELETE SET NULL on an append-only table** (20260927140000:117) | **✘ DEFECT** |
| audit_logs, account_scope_audit_log, reference_change_log, loyalty_program_membership_audit, whatsapp_gateway_audit_log, inventory_cutoff_audit_events, hr_payroll_audit, hr_attendance_audit | various | FK users | ok while no hard delete |
| destructive_ops_audit_log, hr_kpi_audit_log, incentive_payout_audit_log, support_conversation_events, notification_events, ai_usage_logs | various | raw uuid (+ email text) | ✔ |
| quality evidence (`hr_kpi_evidence`, `variant_kkm_certificates`) | uploaded_by | FK users | ok while no hard delete |

**New defect found:** `sa_authorization_decisions.actor_id` is `REFERENCES public.users(id) ON DELETE SET NULL`, and the table's `sa_reject_decision_mutation` trigger rejects every UPDATE. Deleting any user who has ever passed through `authorize()` fails with `authorization_decisions_are_append_only`. This is the same class of bug that 20260928160000 fixed for two other tables; this one was missed. **Do not re-add FKs to append-only history.** Fix it in Stage 1 by dropping this FK in the same style as 20260928160000.

---

## J. Organization membership model

| Layer | Today | Multi-org? |
|---|---|---|
| `users.organization_id` | single org, drives legacy RLS (`current_user_org_id()` 73 refs, `is_hq_admin()`), S&A actor context (`sa_actor_org_id()` 207 refs), and `guardUserOperation` default resource org (≈175 API files read the actor's users.organization_id) | ✘ |
| `sa_organization_memberships` | multi-row, is_primary, effective dating, source (backfill/derived/manual) | ✔ schema. The lifecycle maintains exactly one derived primary equal to users.organization_id. A MOVER ends derived memberships elsewhere but **keeps manual ones**. |
| `hr_employees.organization_id` | employing org (2 staging mismatches with users) | — |
| organizations.org_type_code (HQ/DIST/MFG/WH/SHOP/END_USER) + parent_org_id | hierarchy used by `sa_org_ancestry` for hierarchical scopes | — |

**Source of truth (recommended).** `sa_organization_memberships` is authoritative for *who belongs where*. `users.organization_id` remains a **compatibility "default / primary context"** equal to the primary membership, and is written only by the provisioning service. **Routes assuming exactly one org:** every `sa_actor_org_id()` RLS use, `guardUserOperation` default org, `financeAllowed(…, users.organization_id)`, `hrCan` (caller org), `getHrAuthContext`, and `updateUserWithAuth` manager / department / position validation. These are fine for single-membership users. A second active membership is honoured by `sa_evaluate_permission` (scopes), but these defaults only ever *ask* about the primary org. Multi-membership therefore works for explicit-resource checks but not for the "current org" defaults. Stage 2 needs an explicit "active organization context" (a session selection validated against memberships).

---

## K. Duplicate / orphan analysis — STAGING (direct read-only SQL, 2026-09-28; counts only)

| Check | Result |
|---|---|
| auth.users / public.users | **1728 / 1723** |
| Auth identities without a public profile | **5** (1 never signed in) |
| Public profiles without an auth identity | 0 (note: `users_id_fkey` is **NOT VALID** on staging, so this is not guaranteed by the constraint for historic rows) |
| Duplicate normalized emails (public / auth) | **0 / 0** |
| Non-canonical (mixed-case / padded) emails | **18**; 0 of them collide with another identity after normalization |
| public.users email ≠ auth email (normalized) | **17** (identifier drift between profile and login) |
| Phone null / not E.164 / not normalized | 29 / 0 / 0 |
| Duplicate phone groups (public) | **1 group of 3 users** (all portal: POWER_USER `811af0a8` verified, POWER_USER `d625cba8`, HQ `6ed9cef8` unverified); 0 groups with ≥2 *verified* holders |
| auth.users phone duplicates | 0 (GoTrue enforces) |
| public.users phone ≠ auth phone | **26** (identifier drift) |
| Email → A while phone → B | 0 distinct conflicts beyond the shared-phone group above |
| Banking fields on public.users | **107** rows (2 portal) |
| HR employees / without valid user / duplicate user mapping | 36 / 0 / 0 |
| HR employee org ≠ user org | **2** |
| HR employee whose user is store-scope | **1** |
| Consumers holding enterprise S&A (active membership / assignment) | **1 / 1** (portal account with role GUEST in HQ, `c1c6122d`) |
| Store-scope users holding a business role (level < 50) | **3** (HQ `59937c40` in HQ org; MANAGER `be783193` and USER `c2d40146` without org) — enterprise-looking users outside S&A |
| Enterprise (portal, active, employed) users missing their membership | 0 |
| Portal users without organization | 0 |
| Duplicate active memberships / multiple primaries | 0 / 0 |
| Duplicate active assignments / orphan assignments / user≠membership user | 0 / 0 / 0 |
| Active assignment on inactive membership / without scope / expired | 0 / 0 / 0 |
| Orphan assignment scopes | 0 |
| Stale access on inactive users (memberships / assignments) | 0 / 0 |
| Manual (administrator-granted) S&A assignments | **1** (new since the first pass) |
| Migration modes | **NEW_ENFORCED 83, LEGACY_RETIRED 11, SHADOW 3** (97) |
| `legacy_authorization.read_only` / `lifecycle.sync_enabled` | **true / true** |
| Account scope × active | portal 51 (all active), store 1672 (all active) |

Catalog facts (staging):
- `public.users` constraints: `users_email_key UNIQUE(email)` (case-sensitive), phone E.164 CHECK, **no phone uniqueness**, `users_id_fkey … ON DELETE CASCADE NOT VALID`.
- No trigger on `auth.users` (`handle_new_user` exists but is not attached); profiles are created by `sync_user_profile` / `ensureUserRow`. `trg_auto_create_hr_employee` creates `hr_employees` for every new HQ user.
- `sa_authorization_decisions_actor_id_fkey` → `public.users` **ON DELETE SET NULL** on an append-only table (defect confirmed; reproduced on the replica: deleting a user with a decision fails with `authorization_decisions_are_append_only`).
- **54 foreign keys to `public.users` are ON DELETE CASCADE**, including Supply Chain history `stock_movements.created_by` and `stock_transfers.created_by`, RoadTour scan events and Serapp conversations: a hard delete (application or `auth.admin.deleteUser`) would silently erase that history. The OTP delete route's history check covered only orders/documents/files/signatures.
- `authenticated` holds table-level INSERT/UPDATE/DELETE on `public.users`; `users_admin_all` is gated by `sa_rls_gate('hr.employee.manage', organization_id, is_hq_admin())` — employee management could change role_code / organization_id / is_active of any user in scope through PostgREST.
- Legacy RLS not wrapped by `sa_rls_gate`: **84 policies on 72 tables**, almost all SELECT visibility (catalogue, orders/documents read, messaging, loyalty admin reads); write policies only on the read-only-guarded legacy stores (roles, hr_access_groups*, hr_permissions) and `hr_attendance_audit` INSERT. 469 policies are gated.

Nothing was merged, deleted or modified.

## K2. Production actual state (§18) — PENDING ACCESS

Production reads were refused by the session tool policy (not by the database). No production value is asserted anywhere in this report. The read-only query set to run (each wrapped in `BEGIN; SET TRANSACTION READ ONLY; … ROLLBACK;`) is `supabase/diagnostics/identity_foundation_readonly_audit.sql` (aggregates only) plus Appendix 2. Values expected to be confirmed: modes (reported ≈ 94 SHADOW / 3 LEGACY_ENFORCED), memberships/assignments by status and source, scope integrity, `legacy_authorization.read_only`, shadow mismatch counts (`sa_shadow_parity_summary`), recent decisions, consumer contamination, stale access, duplicates, orphans.

## L. Settings → Authorization retirement assessment

- `/settings/authorization` → `AuthorizationTab.tsx` (1458 lines): legacy Level 1–50 role permission toggles, department overrides, user search, and a "test permission" tool.
- It is already partially retired. It reads `getLegacyAuthorizationStatus()`, shows a banner linking to `/security-access`, and the server actions refuse writes when `legacy_authorization.read_only` is true. The DB trigger `sa_legacy_store_read_only` backstops `roles`, `departments.permission_overrides` and the HR access groups.
- Gaps: (1) `legacyAuthorizationReadOnly()` returns **false (writable) on RPC error** (`legacy-stores.ts:15`); the DB trigger still protects. (2) In production the switch is presumably false (to verify, Appendix 2), so the page is fully writable there. (3) The page gate is `app/settings/_lib.ts` role_level≤40 (legacy).
- **Recommendation:** make it a **READ-ONLY compatibility view relocated to Security & Access → Technical Access → "Legacy compatibility"** (role_level ↔ compat role map, compat parity, department overrides as evidence). Replace `/settings/authorization` with a redirect. Keep the data until LEGACY_RETIRED is certified for every permission. Delete only in a later clean-up release.

---

## M. Security & Access UI consolidation plan

Existing tabs (`SecurityAccessView.tsx`): Overview · People & Access · Roles & Policies (includes "Operations and migration modes", permission catalogue, scopes, authority) · Governance (requests, delegations, reviews, SoD, emergency) · Technical Access (service identities) · Audit & Diagnostics (decisions, access-change log, parity evidence, simulator).

| Need | Home (no new page) |
|---|---|
| Legacy mapping (role_code → compat role, sa_legacy_compat_rules) | Technical Access → new section "Legacy compatibility" (absorbs /settings/authorization read-only) |
| Migration modes | stays in Roles & Policies ("Operations and migration modes"); add readiness columns from `sa_enforcement_readiness` |
| Compatibility state (read_only switch, compat parity) | Technical Access → Legacy compatibility (status); parity already in Audit & Diagnostics |
| Service identities | Technical Access (exists) |
| **Identity conflicts** (email↔phone split, case-dup emails, auth-without-profile, consumer-in-RBAC, employee org mismatch) | Audit & Diagnostics → new "Identity integrity" panel (read-only report + remediation tickets) |
| Provisioning diagnostics (last JML runs, lifecycle log, users without membership) | People & Access → per-person drawer "Provisioning" + Audit & Diagnostics summary |

---

## N. Recommended canonical identity model (minimal change)

**No new identity table.** `public.users` (1:1 with auth.users) *is* the Central Identity. Changes:

1. **`principal_type`** (text + CHECK, NOT NULL, server-written only), replacing inference from `account_scope` + org type:
   `INTERNAL_EMPLOYEE | DISTRIBUTOR_USER | MANUFACTURER_USER | WAREHOUSE_USER | SHOP_STAFF | CONSUMER`.
   Derivation for backfill: portal+HQ → INTERNAL_EMPLOYEE; portal+DIST → DISTRIBUTOR_USER; portal+MFG → MANUFACTURER_USER; portal+WH → WAREHOUSE_USER (a missing type in the brief; staging has 4); portal+SHOP → SHOP_STAFF; store → CONSUMER (consumers linked to a shop remain CONSUMER; the shop link is a relationship, not staff).
   `account_scope` stays as a compatibility column (= portal iff principal_type ≠ CONSUMER). The lifecycle keys on principal_type ≠ CONSUMER.
2. **Non-human principals** stay in `sa_service_identities` (SERVICE_IDENTITY / INTEGRATION). They must never be rows in users / auth.users. If an integration ever needs row-level attribution, record `actor_kind='service'` + identity_key (already the pattern in `sa_access_change_log.actor_kind`).
3. **`account_status`** (see below) replaces the semantic overload of `is_active`.
4. **Identifier columns:** `email_normalized` (generated `lower(btrim(email))`, UNIQUE where not null), `phone` stays E.164 (already enforced via trigger + CHECK), and a **partial UNIQUE on phone for verified phones** (`phone_verified_at IS NOT NULL`), after the duplicate clean-up. Unverified phones are not unique but can never be used for login or resolution.
5. **HR, banking, consumer profile** move off users over time (projection columns kept read-only during the transition).

**Lifecycle mapping**

| Target | Current representation | Canonical rule |
|---|---|---|
| INVITED | none (admins set passwords; email_confirm forced) | auth user exists, no sign-in yet, invite link outstanding; S&A membership **pending** (no assignments active) |
| ACTIVE | is_active=true (+ employment_status active for portal) | can log in; S&A per assignments |
| SUSPENDED | is_active=false (ad hoc) | temporary; login blocked (GoTrue ban); S&A assignments **suspended, not revoked** (restored on reactivation) |
| DISABLED | is_active=false; JML leaver revokes all S&A | login blocked; S&A revoked (current leaver logic) |
| ARCHIVED | **hard delete today** (blocked by FKs / append-only) | tombstone: row kept, PII minimised per retention policy, login removed, never reused; history keeps resolving the name |

Compatibility: keep `is_active` as a generated / derived column (`account_status IN ('ACTIVE','INVITED')` → true) so the 100+ readers and `sa_actor_org_id()` keep working. `employment_status` stays an HR fact (hr_employees) feeding JML → DISABLED.

---

## O. Recommended identity-resolution rules

One server function, `resolve_or_create_identity(email, phone, principal_type, context)`, service_role only. Every creation path in §B1 calls it.

1. **Normalize.** email → `lower(btrim())` (reject if invalid). Phone → `normalize_phone_e164()` (already canonical: `0xx` → `+60xx`, `00` → `+`, bare `1xxxxxxxx` → `+601…`, 8–15 digits). NULL/empty → absent.
2. **Look up** against the **verified** identifiers only: `email_normalized` (always verified, or confirmed via the admin invite) and phone where `phone_verified_at IS NOT NULL`. Also look up auth.users (GoTrue is the login source).
3. **Decide:**
   - No match → create one identity (auth.users + users atomically; roll back the auth user on failure, as done today).
   - Email and phone both → same user → **reuse** (idempotent; return the existing user_id).
   - Email → user A, phone unknown → **same user**. Add the phone as *unverified*; it becomes an identifier only after OTP.
   - Phone → user A, email unknown → **same user**. Add the email as *pending*; it becomes an identifier only after a verification link. Never auto-replace a verified email.
   - Email → A and phone → B (A≠B) → **BLOCK `IDENTITY_CONFLICT`**. Write an `identity_conflicts` row and surface it in S&A → Audit & Diagnostics. Never merge.
   - Match is ARCHIVED → block (no silent resurrection); DISABLED / SUSPENDED → return it and require reactivation through the lifecycle.
   - Principal-type conflict (e.g. CONSUMER resolves to an INTERNAL_EMPLOYEE) → reuse the identity; add the new relationship (membership / consumer profile). **Never downgrade or upgrade principal type implicitly.** Upgrading CONSUMER → enterprise requires an explicit provisioning step with S&A approval.
4. **Uniqueness:** UNIQUE(email_normalized); partial UNIQUE(phone) WHERE phone_verified_at IS NOT NULL. Keep the id PK.
5. **Recovery:** password reset only via a verified identifier. Phone login (`get_email_by_phone`) must require a verified, unique phone. Replace `LIMIT 1` with "exactly one verified match, else refuse".
6. **Admins never choose "link vs create".** HR and User Management submit the person's details; the service returns `{user_id, outcome: created|reused|conflict}`.

Schema support today: normalization ✔ (phone trigger/CHECK; email partially). Uniqueness ✘ (email case-sensitive, phone none). Verified flags partial (`phone_verified_at` is set by admins without verification). Conflict store ✘. Everything above needs duplicate clean-up first (Appendix 1 Q2–Q4).

---

## P. Module integration contract (platform standard)

```
IDENTITY      Every human actor column is `<role>_user_id uuid` → public.users(id).
              Mutable operational tables: FK ON DELETE NO ACTION (users are archived, never deleted).
              Append-only audit/history tables: raw uuid, NO FK (plus optional actor_display snapshot).
              Non-human actors: actor_kind='service' + service identity_key (sa_service_identities).
              A module never stores its own copy of email/phone/password or a login.

AUTHORIZATION Server routes/actions: guardUserOperation / requireAuthorization(permission, trusted resource).
              Resource org/warehouse/owner come from server-loaded rows, never the request body.
              Database: sa_rls_gate / sa_require_operation on the module's tables and SECURITY DEFINER RPCs.
              Permissions are catalogued in sa_permissions (module.resource.action) with a migration mode
              and a readiness row. A new module starts NEW_ENFORCED (no legacy evaluator).
              SoD: sa_enforce_same_document_sod for maker/checker; authority limits via sa_evaluate_authority.

MODULE OWNS   business state, workflow, calculations, its own master data.
DATABASE OWNS tenant / organization integrity, FK integrity, append-only history.

FORBIDDEN     another user table, another role/permission matrix, role_level/role_code checks,
              "admin" booleans, client-side authorization, identity creation outside
              resolve_or_create_identity().
```

Examples: HR `hr_employees.user_id` (NOT NULL, unique per org) + `hr.*` permissions. Finance `posted_by_user_id` / `approved_by_user_id` (FK NO ACTION on journals; raw on audit) + `finance.*`. Supply Chain: existing columns preserved as-is. RoadTour / E-Commerce: same contract; consumers are identities with principal_type CONSUMER and **no** S&A membership.

---

## Q. Exact staging clean-up scope (proposal only; nothing executed)

1. **Identity integrity (report → decide per row):** 18 uppercase emails (normalize to lowercase after a collision check), ≥5 auth users without a profile (create a store profile or delete the orphan auth user if never used), email/phone duplicates (Appendix 1 Q2–Q4 results → conflict records, manual decision).
2. **RBAC boundary:** 1 portal GUEST (decide consumer → store scope, or real staff → proper role); 1 HQ-role store-scope user (→ portal + membership, or role → GUEST).
3. **HR reset:** truncate the SAFE_TO_RESET HR tables (all empty except hr_employees). Rebuild `hr_employees` from the 36 linked users (fix 2 org mismatches, 1 store-scope employee). Keep master data after review.
4. **Finance reset:** clear gl_journals/lines (1/3), gl_document_postings (1), re-seed gl_accounts/fiscal. Keep payment_terms / payment_gateway_settings.
5. **Dead paths:** none to delete from data.
6. Supply Chain, documents and audit tables: **no clean-up.**

---

## R. Exact migration / application changes required

**Migrations (Stage 1)**
1. `…_sa_decisions_actor_fk_drop.sql`: drop the `sa_authorization_decisions.actor_id` FK (history survives deletion). Mirrors 20260928160000.
2. `…_identity_principal_status.sql`: add `principal_type`, `account_status` (+ CHECKs), backfill from account_scope / org type / is_active. `is_active` becomes consistent via trigger (not generated at first, to avoid rewriting 1.7k readers).
3. `…_identity_identifiers.sql`: `email_normalized` generated column + UNIQUE (after the dup fix); partial UNIQUE verified phone; `identity_conflicts` table (append-only, raw uuids); `resolve_or_create_identity` / `identity_lookup` (service_role only).
4. `…_users_access_columns_guard.sql`: extend the Phase 0A trigger so that **only service_role** may change `role_code, organization_id, account_scope, principal_type, account_status, is_active` (all authenticated callers, not just self). This closes browser writes via `users_admin_all`. Also add `phone` to the self-service protected list (phone changes only via the verified flow).
5. `…_lifecycle_membership_source.sql`: `sa_sync_user_lifecycle` keys on principal_type / account_status. SUSPENDED suspends (a new status) rather than revokes. Compat-role derivation is permanently disabled after cut-over (equivalent to read_only).
6. `…_get_email_by_phone_verified.sql`: exactly one verified match.
7. (Stage 2) `hr_employees` becomes the employment source: NOT NULL user_id, UNIQUE(user_id, organization_id), move employment columns, compatibility view.

**Application**
- New `lib/identity/provisioning.ts` (server-only). Every B1 path calls it. Retire `createUserForDepartment`, the HR create branch, `signup()`, `DatabaseSetup`, `AuthDiagnostic`, and old `UserManagement.tsx`.
- Add User wizard: Basic → Organization → **Initial access (S&A role + scope via `sa_assign_role`)** → Review. Banking and Business move to Consumer / Employee profiles. Use invite instead of an admin-set password.
- HR "Add employee": single form → provisioning → hr_employees. Remove the Link/Create tabs.
- `updateUserWithAuth`: identity fields only. Org / access moves go through a provisioning "move" (destination org authorized).
- Convert the ~20 class-A legacy decisions (§D) to S&A guards. Replace `usePermissions` with an S&A capability endpoint.
- `/settings/authorization` → redirect; Technical Access → Legacy compatibility (read-only); Audit & Diagnostics → Identity integrity.
- `legacyAuthorizationReadOnly()` fails **closed**.
- `ensureUserRow`: never portal by email domain.

---

## S. Test plan

1. **Unit / contract (vitest):** resolution matrix (7 cases incl. conflict, archived, principal upgrade), normalization table (MY/intl phone forms, case / whitespace emails), wizard payload contract, and an extension of `phase0a-containment-contract.test.ts` for the new protected columns.
2. **SQL security suites on local PG17 replicas** (existing harness `supabase/tests/security/*`, schema-only dumps of prod + staging; never role-switch probes on live DBs): authenticated cannot change role_code / org / scope / status on any row; `resolve_or_create_identity` not executable by anon / authenticated; unique constraints; conflict rows append-only; user archive with decisions / audit rows succeeds; hard delete with Supply Chain history still refused.
3. **JML:** joiner → membership + baseline; mover (org) ends derived memberships only; suspend → suspended, reactivate → restored; disable → revoked; archived → no access; consumer never gets a membership.
4. **Parity:** `sa_compat_parity_report` / `sa_shadow_parity_summary` unchanged or improved on the staging replica before and after the migrations.
5. **Route coverage gate** (`route-coverage.test.ts`): every identity route classified.
6. **Staging UAT:** Add User (new / existing email / existing phone / conflict), HR add employee, consumer signup (OTP), shop linking, phone login, password reset, suspend / reactivate, archive.
7. **Supply Chain regression:** order / transfer / QR / document screens still show historical actor names for archived users.

---

## T. Rollback strategy

- Every migration is additive (new columns / tables / functions / constraints). The rollback SQL is recorded in each header (pattern of 20260928160000). Dropping the new columns and functions restores prior behaviour.
- The unique constraints are created `NOT VALID`→`VALIDATE` only after the clean-up, and can be dropped independently.
- The trigger-guard extension is a single `CREATE OR REPLACE` of the Phase 0A function (restore the prior body).
- App: the provisioning service sits behind a feature flag (`identity.resolution_v1`). The old paths stay until the flag is certified, then are removed in Stage 2.
- Staging data clean-up: export affected ids / rows (non-PII keys + encrypted backup) before each step; no hard deletes of identities.
- Production: no migration-mode changes in Stages 1–2. The mode cut-over is Stage 3 and per permission is reversible via `sa_set_migration_mode` (logged).

---

## U. Production cut-over prerequisites

1. §18 verified with actual counts (Appendix 2). Production DB state on record: modes, read_only switch, memberships / assignments, shadow mismatches.
2. Stage 1 + 2 migrations applied and certified on staging, with the identity-integrity report clean (0 conflicts unresolved, 0 case duplicates, 0 consumer-in-RBAC, 0 auth-without-profile).
3. Production duplicate / orphan report (Appendix 2) reviewed; remediation plan approved.
4. Every bare `guardUserOperation` route audited for an inline legacy check (the "open in SHADOW" list). Parity mismatch rate below the agreed threshold for 14 days per permission.
5. All class-A legacy decisions converted; no non-gated `is_hq_admin()` RLS policy on identity / S&A / HR / Finance tables (Appendix 1 Q9 = 0).
6. At least 1 manual S&A assignment workflow exercised end to end (staging has none yet); SoD rules reviewed.
7. `legacy_authorization.read_only=true` in production, and `/settings/authorization` read-only.
8. Rollback rehearsal on a production replica.

---

## V. Remaining risks / blockers

| # | Risk / blocker | Severity |
|---|---|---|
| 1 | **Production state not verified** (tool policy refused the read-only connection). The "94 SHADOW / 3 LEGACY_ENFORCED" figure is unconfirmed. | Open for §18 (not architectural) |
| 2 | Staging email / phone duplicates — **measured** (§K): 0 email duplicates, 18 non-canonical emails (no collisions), 1 shared-phone group of 3, 17/26 profile↔login identifier drifts. | Data clean-up (Stage 2) |
| 3 | `sa_authorization_decisions.actor_id` FK on an append-only table → user deletion fails | High (defect) |
| 4 | `createUserForDepartment`: HR_MANAGER / legacy role_level≤20 can create a user with **any role_code** (incl. SA); no S&A | High |
| 5 | `users.role_code` / `organization_id` writable by any authenticated user passing `users_admin_all` (now gated by `hr.employee.manage`, not `platform.user.manage`) → role / org changes from the browser; in prod (read_only presumably false) role_code grants compat roles | High |
| 6 | 233 bare `guardUserOperation` calls default the legacy evaluator to allow → in SHADOW, authorization equals whatever inline check follows (some none) | High for the cut-over |
| 7 | Email uniqueness case-sensitive (18 mixed-case rows); phone not unique; `get_email_by_phone` LIMIT 1 | Medium |
| 8 | `updateUserWithAuth` authorizes only the source org for moves | Medium |
| 9 | `ensureUserRow` grants `portal` scope by email domain | Medium |
| 10 | HR create paths broken (FK violations); HR data duplicated between users and hr_employees (2 org mismatches) | Medium (HR not live) |
| 11 | Banking data on the identity row (107 users) | Medium (privacy) |
| 12 | Single-org defaults in ~175 API files and 207 `sa_actor_org_id()` uses | Medium (multi-membership) |
| 13 | Non-gated legacy RLS (`is_hq_admin()` 178 refs) not quantified without catalog access | Unknown until Q9 |
| 14 | `legacyAuthorizationReadOnly()` fails open (app layer; DB still guards) | Low |
| 15 | `public.users.phone` self-editable without verification (drift from auth phone) | Low–Medium |
| 16 | 54 ON DELETE CASCADE foreign keys to users (incl. `stock_movements`, `stock_transfers`): hard delete erases history | **High** (fixed in Stage 1 by the history delete guard) |
| 17 | Phone verification timestamps were set by administrators/self-edits without OTP (339 staging rows) — resolution treats them as verified | Medium (Stage 1 stops new unverified stamps; historic data review in Stage 2) |

---

## Implementation sequence (3 stages)

**Stage 1 — Identity foundation** (schema + service; no mode changes)
Drop the decisions FK · principal_type + account_status · email_normalized / verified-phone uniqueness (after clean-up) · identity_conflicts · `resolve_or_create_identity` · service-role-only guard on access columns · verified-only phone login · staging identity clean-up (Q1) · Identity-integrity panel.

**Stage 2 — Provisioning + legacy retirement**
Single provisioning service used by User Management, HR, consumer signup and imports · wizard redesign (initial S&A role, no banking) · hr_employees as the employment source · retire duplicate creators · convert class-A legacy decisions · Settings → Authorization read-only redirect · HR / Finance dev-data reset · lifecycle SUSPENDED / ARCHIVED.

**Stage 3 — Certification + production cut-over**
Production read-only verification and duplicate report · bare-guard route audit · replica rehearsal · `legacy_authorization.read_only=true` in production · per-permission SHADOW → NEW_ENFORCED in waves with parity evidence · LEGACY_RETIRED last.

---

## Appendix 1 — Staging read-only SQL pack (aggregates only; no PII in output)

Run as a read-only session: `SET default_transaction_read_only = on;`. Do **not** use `SET ROLE` probes on live Supabase (known segfault).

```sql
-- Q1 auth/public orphans + trigger presence
select (select count(*) from auth.users a where not exists (select 1 from public.users u where u.id=a.id)) auth_without_profile,
       (select count(*) from auth.users a where not exists (select 1 from public.users u where u.id=a.id) and a.last_sign_in_at is null) never_signed_in,
       (select count(*) from pg_trigger t where t.tgrelid='auth.users'::regclass and not t.tgisinternal) auth_user_triggers;
-- Q2 duplicate normalized emails (public + auth)
select 'public' src, count(*) groups, coalesce(sum(n),0) rows from (select lower(btrim(email)) k, count(*) n from public.users where email is not null group by 1 having count(*)>1) d
union all select 'auth', count(*), coalesce(sum(n),0) from (select lower(btrim(email)) k, count(*) n from auth.users where email is not null group by 1 having count(*)>1) d;
-- Q3 duplicate normalized phones (public), split by verified
select any_verified, count(*) groups, sum(n) rows from
 (select public.normalize_phone_e164(phone) k, bool_or(phone_verified_at is not null) any_verified, count(*) n
  from public.users where phone is not null group by 1 having count(*)>1) d group by 1;
-- Q4 email→A / phone→B conflicts (public vs auth identifiers)
select count(*) conflicts from public.users u join auth.users a on a.phone is not null
  and public.normalize_phone_e164(a.phone)=u.phone and a.id<>u.id;
-- Q5 public/auth identifier drift
select count(*) filter (where lower(u.email)<>lower(a.email)) email_drift,
       count(*) filter (where u.phone is distinct from public.normalize_phone_e164(a.phone)) phone_drift
from public.users u join auth.users a on a.id=u.id;
-- Q6 users constraints actually present
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.users'::regclass order by 1;
-- Q7 FKs to users with delete action, on append-only tables
select c.conrelid::regclass tbl, c.conname, c.confdeltype from pg_constraint c
where c.contype='f' and c.confrelid='public.users'::regclass
  and c.conrelid::regclass::text in ('sa_authorization_decisions','sa_access_change_log','sa_sod_violations');
-- Q8 active-session / banned users
select count(*) filter (where banned_until > now()) banned, count(*) filter (where deleted_at is not null) soft_deleted from auth.users;
-- Q9 legacy RLS not wrapped by S&A gates
select schemaname, tablename, policyname, cmd from pg_policies
where schemaname='public' and (coalesce(qual,'')||coalesce(with_check,'')) ~ '(is_hq_admin|is_power_user|is_super_admin|role_level|current_user_role_level)'
  and (coalesce(qual,'')||coalesce(with_check,'')) !~ 'sa_rls_gate' order by 2,3;
```

## Appendix 2 — Production read-only SQL pack (§18)

```sql
SET default_transaction_read_only = on;
select mode, count(*) from public.sa_migration_modes group by 1 order by 1;
select setting_key, setting_value from public.sa_settings order by 1;
select status, source, membership_type, count(*) from public.sa_organization_memberships group by 1,2,3;
select a.status, a.source, br.source role_source, count(*) from public.sa_role_assignments a join public.sa_business_roles br on br.id=a.role_id group by 1,2,3;
select sd.scope_type, sd.status, count(*) from public.sa_scope_definitions sd group by 1,2;
select account_scope, is_active, count(*) from public.users group by 1,2;
select (select count(*) from auth.users) auth_users, (select count(*) from public.users) public_users;
select migration_mode, comparison, count(*) from public.sa_authorization_decisions
 where occurred_at > now()-interval '30 days' group by 1,2 order by 1,2;
select * from public.sa_shadow_parity_summary(interval '30 days');
select * from public.sa_compat_parity_report(null);
-- then Appendix 1 Q1–Q9 (aggregate only)
```

---

**Status (revision 2):** staging evidence complete; production §K2 pending access (not an architectural blocker). No architectural blocker was found.

IDENTITY + S&A FOUNDATION AUDIT COMPLETE — READY FOR IMPLEMENTATION
