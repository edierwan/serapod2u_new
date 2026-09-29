# Identity Foundation — Stage 2C: remaining legacy role decisions

Date: 2026-09-29 · Branch: `security/identity-foundation-finalization`
Scope: every `role_level` / `role_code` / legacy-role authorization decision left in
`app/src` (HR, Finance, Supply Chain / Orders, Customer / CRM, E-Commerce,
Marketing, Settings / Platform). Production was not read; the parity figures are
from staging (read-only, `supabase/diagnostics/identity_stage2c_parity_readonly.sql`).

## Method

1. Every line comparing or matching a legacy role (`role_level`, `roleLevel`,
   `role_code`, `roleCode`, `isSuperAdmin`, `isHqAdmin`, `is_hq_admin()`, …) —
   511 lines in 239 files — was extracted and classified by hand after an
   automated first pass. Comments, `select(...)` column lists and imports
   were dropped, leaving 443 occurrences.
2. A server-side check is **COMPATIBILITY-ONLY** when it runs only as the
   `legacy` evaluator of an S&A decision (`guardUserOperation`, `userAllowed`,
   `financeAllowed`, `hrCan`, `kpiCan`, `attendanceCan`, `isAdminUser`, …). It
   decides only in LEGACY_ENFORCED / SHADOW.
3. A server-side check is **SERVER AUTHORIZATION** when it still decides in
   NEW_ENFORCED. That covers three shapes:
   - legacy-only (no S&A at all);
   - a *residual gate* — an extra legacy check after the S&A guard, which denies
     S&A-authorized users;
   - a *bypass* — a legacy rule OR-ed in front of S&A.
4. A conversion is **safe** only when S&A grants nobody the legacy rule denies.
   This is checked on real data as `widen_if_converted` in the parity
   diagnostic, which runs `sa_evaluate_permission` against the legacy rule for
   every active user.

Staging modes at inventory time: every `finance.*`, `hr.*`, `customer.*`,
`ecommerce.*`, `inventory.*`, `platform.*` (except `platform.identity*`),
`supply_chain.*`, `warehouse.*`, `manufacturing.*` and `roadtour.*` permission is
NEW_ENFORCED. `platform.identity*`, `inventory.stock_count.create/post` and
`security.emergency_access.grant` are SHADOW. `security.*` is LEGACY_RETIRED.

## Totals (occurrences, before 2C)

| Module | Server authorization | UI / page gate | Display-only | Compatibility-only | Dead / unused | Total |
|---|---:|---:|---:|---:|---:|---:|
| HR | 15 | 18 | 1 | 32 | 0 | 66 |
| Finance | 3 | 6 | 1 | 19 | 0 | 29 |
| Supply Chain / Orders | 19 | 58 | 5 | 9 | 0 | 91 |
| Customer / CRM | 27 | 20 | 5 | 19 | 1 | 72 |
| E-Commerce | 2 | 2 | 0 | 0 | 0 | 4 |
| Marketing | 8 | 1 | 0 | 0 | 6 | 15 |
| Settings / Platform | 30 | 71 | 3 | 53 | 9 | 166 |
| **All** | **104** | **176** | **15** | **132** | **16** | **443** |

Occurrences are lines. Counted as **decision sites** (one rule applied at one
place: a route handler, a server action or a helper call), the server
authorization set is 98 sites. 2C converted 45; 53 are deferred for the reasons
below.

| Module | Decision sites | Converted in 2C | Deferred |
|---|---:|---:|---:|
| HR | 23 | 23 (the assistant's line-manager tier stays legacy) | 0 |
| Finance | 3 | 3 | 0 |
| Supply Chain / Orders | 14 | 1 | 13 |
| Customer / CRM | 24 | 4 | 20 |
| E-Commerce | 2 | 0 | 2 |
| Marketing | 7 | 0 | 7 |
| Settings / Platform | 25 | 14 | 11 |
| **All** | **98** | **45** | **53** |

## Finance (checked explicitly)

| Surface | Status |
|---|---|
| `finance.module.view` — `app/finance/_lib.ts` page gate | S&A (legacy `view_settings` / canonical staff ≤ 40 as evaluator) — compatibility-only |
| `finance.settings.manage` — accounting settings, system-settings, fiscal years (+ periods), posting rules, exchange rates, finance config audit | S&A via `financeAllowed` — compatibility-only (12 sites) |
| `finance.account.manage`, `finance.data.reset` | S&A via `financeAllowed` — compatibility-only (6 sites) |
| `finance.payroll_integration.manage` — `/api/hr/accounting/{control-accounts,mappings}` | S&A via `hrCan` — compatibility-only |
| `finance.payroll_integration.manage` — **HR→GL server actions** `applyHrCoaTemplate`, `setupDefaultHrGlMappings`, `saveHrGlMapping` (`modules/hr/accounting/actions.ts`) | **Was legacy-only**: `role_level > 20` denied, so a missing role level passed and the organization came from the client. **Converted**: S&A on the organization being configured, and the legacy evaluator no longer passes a null level |
| Payroll → Finance — `/api/hr/payroll/post-to-gl` (`hr.payroll.release`), `/api/hr/finance/post-*` (`hrCan`) | S&A — compatibility-only |
| `finance.payment.approve` — `/api/documents/payment-request/[id]/approve` | S&A on the request's company; `is_hq_admin()` / `is_power_user()` is the legacy evaluator; the DB RPC re-checks maker/checker — compatibility-only |
| `/api/accounting/status` "User Permissions" checklist row (`role_level <= 20`) | Display-only (a setup-checklist message; grants nothing). Not converted |
| Finance UI gates: `GLJournalView`, `PendingPostingsView` (post button), `AccountingTab`, `ChartOfAccountsTab`, `DefaultAccountsSettings`, `PostingRulesSettings`, `FinanceCurrencySettingsView`, `BalancePaymentRequestCard` | UI/page gates on the legacy level. The server decides with S&A, so the risk is UX drift (an S&A-granted user sees no button), not access. Needs a client S&A capability read — see dependencies |
| `getHrAccountingConfig`, `validateHrGlMappings` (reads) | No app-level check (RLS only). Not a legacy decision, so out of scope for 2C; noted for Stage 3 |

**Remaining Finance server-side legacy decisions after 2C: none.**

## Converted in 2C

| Where | Permission (resource) | Was | Parity (staging, widen) |
|---|---|---|---:|
| `lib/actions/departments.ts` — 5 department + 6 org-chart actions | `hr.employee.manage` (caller's org; same-org checks kept) | legacy-only | 0 |
| `lib/actions/hrPositions.ts` — create/update position | `hr.employee.manage` (caller's org) | legacy-only | 0 |
| `lib/actions/hrSettings.ts` — save settings | `hr.settings.manage` (caller's org) | legacy-only | 0 |
| `/api/users/[id]/hr` — target user / department / position / manager in another org (4) | `hr.employee.manage` on the **target's** org (`hrCanIn`) | "same org or role_level ≤ 20" | S&A narrower (scopes reach descendants only) |
| `/api/hr/positions/[id]` PATCH/DELETE cross-org (2) | `hr.employee.manage` on the position's org | "same org or role_level = 1" | S&A narrower |
| HR assistant `chat` + `chat/stream` data tier | `hr.compensation.view` → HR_MANAGER tier; `hr.employee.manage` → HR_STAFF tier | `resolveHrRole(role_code, role_level)` | 0 |
| `/api/hr/kpi/reviews/[id]/request-changes` | `hr.performance.manage` | legacy `isKpiHrManager ‖ S&A` (bypass) | 0 |
| `modules/hr/accounting/actions.ts` (3) | `finance.payroll_integration.manage` (target org) | legacy-only, null-level pass | 0 |
| `/api/warehouse/confirm-shipment` | `warehouse.shipment.manage` on the session's warehouse (`authorizeShipmentActor`, as the sibling shipment routes) | residual Phase 0A rule | 0 |
| `/api/journey/{create,update,delete,duplicate}` | `customer.campaign.manage` | residual `role_level ≤ 30` | 0 |
| `/api/admin/{restore-data,send-deletion-notification,export-data,upload-template-preview}`, `/api/admin/cleanup/{static-report,export,runtime-report}` | `platform.data.destructive` | residual `role_level = 1` | 0 |
| `/api/admin/doc-migration` POST, `/api/admin/fix-shop-rls` | `platform.data.destructive` | residual `≤ 10` / `SA,HQ` | 0 |
| `/api/admin/states` | `platform.settings.manage` | residual admin role list | 0 |
| `/api/organizations/delete/request-otp` | `platform.organization.manage` (audit row kept) | residual `≤ 10` / codes | 0 |
| `/api/organizations/delete/verify-and-delete` | `platform.data.destructive` | residual `≤ 10` / codes | 0 |
| `/api/organizations/import` | `platform.organization.manage` | residual `≤ 50 or MANAGER` | 0 |
| `/api/admin/bulk-delete-users` | `platform.data.destructive` (destructive-ops guard) | residual `role_level ∈ {1,10}` **on a `callerId` read from the request body** | 0 |

In every converted site the old rule survives only as the `legacy` evaluator.

Security fix, `bulk-delete-users`: the route took `callerId` from the body. It
used that id for the residual role check, the self-exclusion and the audit
attribution. The route now uses the verified session user from
`assertDestructiveOpsAllowed`.

Where "S&A narrower" appears, the only users who lose access on staging are
store-scope (consumer) accounts carrying staff role codes, and one HQ-coded
user in a warehouse organization (`MISSING_CONTEXT`). Both are correct denials.

## Deferred (not safe in 2C) — why

| Where | Permission | Blocker | Staging widen |
|---|---|---|---:|
| `/api/admin/support/*` (15 routes) | `customer.support.manage` | Compatibility grants `≤ 40`; the routes allow only `SA/HQ/POWER_USER`. Removing the gate hands the admin inbox (read via the admin client) to managers, shop and HQ users | 20 |
| `/api/admin/{shop-staff-performance,consumer-performance,shop-consumers,shop-points-report}` | `customer.consumer.view` | Same compatibility width (`≤ 40`) | 20 |
| `/api/master-banner` (GET/POST) | `customer.campaign.manage` | Legacy is HQ-org and `≤ 30`; compatibility has no org-type condition (HQ-coded users in MFG orgs, POWER_USER in SHOP) | 9 |
| `/api/message-setup/{short-links,short-links/[id],preview}` | `customer.campaign.manage` | Legacy `≤ 20` vs compatibility `≤ 30` | 9 |
| `/api/wa/marketing/audience/resolve` | `customer.campaign.manage` | Legacy `SA/HQ/POWER_USER` vs compatibility `≤ 30` | 9 |
| `/api/admin/adjustments/[id]/{status,assign}` | `manufacturing.adjustment.manage` | Legacy `SA` only vs compatibility `≤ 40` | 43 |
| `/api/manufacturer/adjustments*` (7 sites) | `manufacturing.adjustment.manage` | "`SA` sees every manufacturer's adjustments" is a data-scope rule; compatibility `≤ 40` plus hierarchy scopes would open it to all HQ staff | 43 |
| `/api/warehouse/{pending-receives,scan-history,intake-history}` | `inventory.report.view` | "Super Admin sees all warehouses" list scope. S&A has no list-scope resolver (scope types: organization, warehouse, own_record) | — |
| `/api/reporting/stats` | `reporting.analytics.view` | Same all-organizations list scope | — |
| `/api/loyalty/memberships/organizations` | `customer.program.manage` | Org filter by `role_level ≤ 50` — a list scope | — |
| `/api/orders/actors` | — | Registered EXCEPTION (relation-based read helper; orders RLS enforces tenancy) | — |
| `/api/settings/notifications/email-activity`, `/api/settings/notifications/sms-activity*` | none fits | Monitors allow every canonical HQ staff member. `platform.settings.manage` is `≤ 20`, so converting would **narrow** 14 HQ managers/users. Needs a monitor-view permission | −14 |
| `/api/user/update-profile` (admin editing another user) | `platform.user.manage` | Legacy `role_level ∈ {1,10}` vs compatibility `≤ 30` (also granted to `edit_users`) | 18 |
| HR assistant line-manager tier (internal fields: work email, hire date, employment type) | `hr.employee.view` | That permission is `≤ 20`. Converting would narrow about 28 portal staff (levels 30–50) — a policy decision | −28 |
| `/api/admin/delete-user-otp/{request,verify-and-delete}` actor `≤ 10` **and** target-hierarchy rule; `/api/users/reset-password` and `/api/admin/_user-management-scope.ts` target hierarchy | `platform.identity.delete` / `platform.identity_access.manage` / `platform.identity.view` (SHADOW) | "Never act on a more privileged user" compares legacy levels. Converting the actor check alone would disarm it. Moves with the identity permissions leaving SHADOW | — |

Page gates (server-rendered, UI/PAGE GATE):

| Page | Rule | Status |
|---|---|---|
| `app/crm/_lib.ts` | HQ `≤ 50` | No `crm.module.view` permission; `customer.consumer.view` would widen 13 |
| `app/marketing/_lib.ts` | HQ `≤ 30` | No marketing view permission |
| `app/catalog/_lib.ts` | HQ/DIST/SHOP `≤ 50` | No catalog view permission |
| `app/ecommerce/_lib.ts` | HQ `≤ 30` | `ecommerce.store.manage` would widen 6 (HQ@MFG, POWER_USER@SHOP) |
| `app/manufacturer/quality-issues/page.tsx` | `SA` or manufacturer org | Same blocker as the manufacturer adjustment scope |
| `app/supply-chain/[...slug]/page.tsx` | HQ `role_level ∈ {1,10}` | UI gate over S&A-guarded APIs |

The APIs behind these pages are S&A-guarded, so these gates hide pages; they
do not protect data.

## Dead / unused (not converted)

- `/api/admin/whatsapp/{settings,admins,admins/[id]}` select `users.is_super_admin`,
  a column that does not exist. The profile read fails, so every call returns
  400. The legacy check is unreachable.
- `/api/ai/metrics` reads `organization_members`, which does not exist on
  staging, so it always returns 403.
- `/api/wa/marketing/{campaigns/[id],segments,segments/[id]}` branch on
  `role_code === 'SUPER_ADMIN'`, a role code that does not exist (the roles are
  SA, HQ, POWER_USER, PU, DIST, MANAGER, MFG, WH, SHOP, USER, GUEST).
- `app/journey-builder/page.tsx` selects `users.role_level`, which does not
  exist, so it always redirects. `/engagement/journey-builder` replaced it.

## Cross-module dependencies

1. **Compatibility-rule precision (CRM, Marketing, E-Commerce, Supply).** Most
   deferred gates are safe only once the compatibility grants for
   `customer.support.manage`, `customer.consumer.view`,
   `customer.campaign.manage`, `ecommerce.store.manage` and
   `manufacturing.adjustment.manage` stop being "role level only". That needs
   role codes or an org-type condition on `sa_legacy_compat_rules`, or narrower
   compatibility grants. It is a migration, so management runs it; the route
   conversions follow.
2. **List-scope resolver (Supply, Platform reporting, Loyalty).** The "Super Admin
   sees all organizations" branches need S&A to answer "which organizations may
   this actor read for permission P". `sa_org_ancestry` exists; a resolver
   function does not.
3. **Identity permissions leaving SHADOW (Platform, HR).** Target-hierarchy
   protection (delete / reset password / user list visibility) moves with
   `platform.identity.*`.
4. **Module-view permissions (CRM, Marketing, Catalog, notification monitors).**
   These have no catalog keys. Adding them is a catalog + migration change.
5. **Client capability read (all modules, 176 UI occurrences).** UI gates read
   the legacy level. A read-only "my effective permissions" endpoint would let
   the UI follow S&A. Until then the server stays authoritative and the UI can
   under-show.
6. **HR ↔ Finance.** `finance.payroll_integration.manage` now gates both the HR→GL
   API routes and the HR→GL server actions; `hr.payroll.release` gates GL
   posting of payroll. Changes to either permission's grants affect both modules.

## Regression

- Type check: no new errors against the Stage 2 baseline (TS2589 excluded as
  before).
- Unit and contract tests: full vitest suite. The only failures (4 files,
  11 tests: `VariantDialog`, stock-config UI contract, and two inventory UI
  suites) fail identically on the unchanged baseline.
- New: `src/lib/security-access/stage2c-conversions.test.ts` (30 tests) and
  `src/modules/hr/accounting/actions.authorization.test.ts` (3 tests).
- Route coverage gate: unchanged; no new routes and no permission changes.
- No migration and no mode change. Not deployed.
