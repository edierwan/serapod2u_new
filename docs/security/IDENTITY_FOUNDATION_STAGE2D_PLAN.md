# Identity Foundation — Stage 2D: Deferred Authorization Closure (plan)

Status: **plan only**. Stage 2 is **not complete**: 2C is deployed to staging
(`2ff48b44`, containing `54cd532b` and `3b7dd218`) and its signed-in UAT (part
B) is pending with management. No production change is part of this plan
until Stage 3.

Inputs:

- `IDENTITY_FOUNDATION_STAGE2C_INVENTORY.md` (98 server decisions, 45 converted);
- `identity_stage2c_parity_readonly.sql` (staging parity);
- `identity_stage2c_staging_uat.sql` (decision matrix, 165/165).

## 1. The 53 deferred decisions, by the capability that unblocks them

| # | Capability needed | Decisions | Where |
|---|---|---:|---|
| C1 | **Precise compatibility grants**: org-type- and role-code-aware compatibility rules, or narrower grants | 30 | `admin/support/*` (15); CRM reports `shop-staff-performance`, `consumer-performance`, `shop-consumers`, `shop-points-report` (4); `master-banner` (2); `message-setup/short-links`, `short-links/[id]`, `preview` (6); `wa/marketing/audience/resolve` (1); `admin/adjustments/[id]/{status,assign}` (2) |
| C2 | **Organization-readable scope**: which organizations the actor may read for permission P | 12 | `manufacturer/adjustments*` (7); `warehouse/{pending-receives,scan-history,intake-history}` (3); `reporting/stats` (1); `loyalty/memberships/organizations` (1) |
| C3 | **Identity permissions leaving SHADOW + hierarchy protection** | 6 | `admin/delete-user-otp/{request,verify-and-delete}` (actor ≤ 10 and "target not more privileged", 4); `users/reset-password` target rule (1); `admin/_user-management-scope` visibility (1) |
| C4 | **Missing view permission** (monitors) | 3 | `settings/notifications/email-activity` (1); `settings/notifications/sms-activity` + `refresh-status` (2) |
| C5 | **Management policy decision** | 1 | `user/update-profile`: should another user's profile be editable here by `platform.user.manage` holders, or only through User Management? |
| C6 | **Registered exception** (keep, re-review in Stage 3) | 1 | `orders/actors`: relation-based read helper; orders RLS enforces tenancy |
| | **Total** | **53** | |

Related items that are not among the 53 server decisions:

- 176 UI/page-gate occurrences, including 8 Finance UI gates and the CRM,
  Marketing, Catalog and E-Commerce page gates;
- the HR assistant's line-manager tier;
- the HR→GL read actions, which have no app-level check;
- dead code (queued in its own task).

## 2. Workstreams

Each workstream has three parts:

- a management-run migration (where needed), with rollback and a staging
  replica test first (`supabase/tests/security`);
- app changes with contract tests, gated by the parity diagnostic
  (`widen_if_converted = 0`);
- a staging UAT, like 2C (a decision matrix, signed-in probes and
  decision-log verification).

### W1 — Organization-readable scope capability (C2, 12 decisions)

- **DB** (migration): `sa_readable_organizations(p_actor uuid, p_permission text) returns setof uuid`.
  - It holds for the org of every active assignment granting P, plus its
    descendants (reusing `sa_org_ancestry` / `sa_scope_matches`), plus
    warehouse scopes.
  - It is STABLE, SECURITY DEFINER, service_role-only, and respects migration
    mode.
  - It mirrors `sa_evaluate_permission` exactly. A test asserts that for every
    staging actor, org ∈ result ⇔ evaluate(actor, P, org) = ALLOW.
- **App**: `readableOrganizationIds(userId, permission)` in
  `lib/security-access`. Each "Super Admin sees all" branch becomes
  `.in('organization_id', readable)`, and a single-row read checks
  `readable.includes(row.org)`.
- **Parity**: widening is expected for no one. Today only `role_level = 1` or
  `role_code = 'SA'` sees everything; after W1 an HQ-scoped holder of P reads
  its descendants.
  - Where S&A compatibility grants P to `≤ 40` (`manufacturing.adjustment.manage`),
    this widens, so W1 depends on W2 for the manufacturer adjustments.
  - Warehouse, reporting and loyalty can go first.

### W2 — Precise compatibility grants (C1, 30 decisions; also unblocks W1 manufacturer)

- **DB** (migration): add `org_type_codes text[]` to `sa_legacy_compat_rules`, so
  compatibility roles are granted P only in memberships whose org type matches.
  - `sa_refresh_compat_role` honours it.
  - Set the rules so that S&A reproduces each route's actual legacy rule:

    | Permission | Rule |
    |---|---|
    | `customer.support.manage` | `SA,HQ,POWER_USER` at HQ |
    | `customer.consumer.view` | `SA,HQ,POWER_USER` at HQ |
    | `customer.campaign.manage` | `≤ 30` at HQ for banner/campaign; the journey routes keep `≤ 30` any org. The journey/banner difference means `customer.campaign.manage` may need splitting — see below |
    | `ecommerce.store.manage` | `≤ 20` at HQ |
    | `manufacturing.adjustment.manage` | `≤ 40` for the MFG workflow, `SA` for administration. May need splitting — see below |

- **Catalog decision**: where one permission serves two different legacy
  audiences, split it rather than widen:
  - `customer.campaign.manage` → `customer.journey.manage` + `customer.campaign.manage`;
  - `manufacturing.adjustment.manage` → `manufacturing.adjustment.respond`
    (manufacturer) + `manufacturing.adjustment.administer` (HQ).

  New keys start in SHADOW, reach parity, then go NEW_ENFORCED.
- **App**: residual gates move into `legacy:` evaluators, as in 2C, once parity
  is 0 for each gate.
- **Risk**: explicit (non-compatibility) business-role grants are unaffected;
  only generated `legacy-*` roles change. The change is recorded as audited
  `sa_access_change_log` rows.

### W3 — Missing CRM / Marketing / Catalog / monitor view permissions (C4 + page gates)

- **Catalog** (migration): `customer.crm.view`, `marketing.module.view`,
  `product.catalog.view`, `platform.notification_monitor.view`.
  - Compatibility copies today's page rules:

    | Permission | Rule |
    |---|---|
    | `customer.crm.view` | HQ `≤ 50` |
    | `marketing.module.view` | HQ `≤ 30` |
    | `product.catalog.view` | HQ/DIST/SHOP `≤ 50` |
    | `platform.notification_monitor.view` | canonical HQ staff `≤ 40` |

  - These rely on W2's org-type support. They start in SHADOW.
- **App**:
  - `app/crm/_lib.ts`, `app/marketing/_lib.ts` and `app/catalog/_lib.ts` use
    `authorizeOperation` with the page rule as legacy;
  - `app/ecommerce/_lib.ts` uses `ecommerce.store.manage` once W2 lands;
  - the email/SMS monitors use `platform.notification_monitor.view`.
- **Exit**: SHADOW parity = 0 mismatches over an agreed window, then NEW_ENFORCED.

### W4 — Identity permissions leaving SHADOW (C3 prerequisite)

Permissions: `platform.identity.view`, `platform.identity.disable`,
`platform.identity.delete`, `platform.identity_access.manage` (all SHADOW today).

- Review `sa_shadow_parity_summary` for these four permissions on staging.
- Fix any compatibility or assignment gaps.
- Management moves them to NEW_ENFORCED with `sa_set_migration_mode`, one at a
  time.
- **Production prerequisite** (from Stage 1): every active portal user has an
  active membership and assignment.

### W5 — Hierarchy protection for delete / reset operations (C3, 6 decisions; after W4)

- **Rule**: "never act on a more privileged identity". Expressed in S&A terms,
  an actor may act on a target only if every permission the target holds
  (active assignments) is held by the actor over the target's organization.
  Super Admin targets need a Super Admin actor.
- **DB** (migration): `sa_actor_dominates(p_actor uuid, p_target uuid) returns boolean`
  (service_role-only). It also covers emergency-access and delegation
  exclusions.
- **App**:
  - `delete-user-otp` request/verify: `platform.identity.delete` on the
    target's org, plus `sa_actor_dominates`;
  - `reset-password`: `platform.identity_access.manage`, plus the same
    dominance rule;
  - the `_user-management-scope` list uses W1's readable organizations, and
    hides targets the actor does not dominate.
  - The legacy level comparison becomes the legacy evaluator only.
- **Tests**: SQL suite cases for SA↔HQ, HQ↔HQ, delegation and suspended
  targets; a route contract test.

### W6 — Browser read-only "my permissions" endpoint (UI gates)

- **API**: `GET /api/security-access/me/capabilities?permissions=a,b,c[&organizationId=]`
  → `{ [permission]: boolean }`.
  - It uses `authorize(..., { log: false })`, an explain-only path, so there are
    no audit rows per page view.
  - It evaluates only the permissions asked for, in the caller's organization
    or a trusted org id.
  - It is cached per request and marked `no-store`.
  - Coverage: SELF.
- **Client**: a `useCapabilities([...])` hook, with the legacy check only as a
  loading-state fallback, never as a grant.
- **Rule**: the UI can hide what the server denies. It must never show an
  action the server would deny, and it never grants anything.

### W7 — Finance UI gates (depends on W6)

- Replace the eight `role_level <= 20` gates with `useCapabilities`:
  - `GLJournalView` and `PendingPostingsView` → `finance.journal.post`;
  - `AccountingTab`, `ChartOfAccountsTab` and `DefaultAccountsSettings` →
    `finance.account.manage` / `finance.settings.manage`;
  - `PostingRulesSettings` and `FinanceCurrencySettingsView` →
    `finance.settings.manage`;
  - `BalancePaymentRequestCard` → `finance.payment.approve` on the request's
    company.
- The `/api/accounting/status` checklist row reports the S&A answer (explain-only).
- **UAT**: a user granted Finance through S&A only (no legacy level) sees and
  uses each control; a legacy admin without S&A does not.

### W8 — HR→GL read actions: app-level authorization

- `getHrAccountingConfig` and `validateHrGlMappings` get
  `financeAllowed(user, 'finance.ledger.view' | 'finance.payroll_integration.manage', legacy, organizationId)`.
- **Parity check first**: today they rely on RLS only, so compare the RLS-allowed
  set with S&A before enforcing.
- Contract and behaviour tests as in 2C.

### W9 — HR assistant line-manager tier (decision required)

Options for management:

1. **Keep** the line-manager tier (internal fields: work email, hire date,
   employment type) for canonical staff at levels 30–50. Implement it as
   `isCanonicalStaff` (an identity fact, not a legacy level) and record it as a
   policy.
2. **Tie it to S&A** `hr.employee.view`. About 28 staging staff at levels 30–50
   would see public fields only.
3. **New permission** `hr.employee.view_internal`, granted by compatibility to
   canonical staff and removable per person.

Recommendation: **3**. It keeps today's behaviour and makes it governable.

### W10 — Dead code and registered exception

- Dead routes and page: handled by the separate task. Remove them or fix them
  onto S&A, and drop their coverage entries.
- `orders/actors`: keep the EXCEPTION and re-review it in Stage 3 against the
  orders RLS.

## 3. Sequence and dependencies

```
W4 ──► W5
W1 (warehouse, reporting, loyalty) ─────────────┐
W2 ──► W1 (manufacturer) ──► W3 (e-commerce page)├─► Stage 2 closure UAT ─► Stage 3
W6 ──► W7                                       │
W8, W9 (decision), W10 ─────────────────────────┘
```

Suggested batches (each: migration → replica test → staging → UAT):

1. **2D-1**: W6, W8, W1 (readable-org function plus the warehouse, reporting
   and loyalty conversions), W9 once decided.
2. **2D-2**: W2 (compatibility precision plus the permission splits, in SHADOW
   first), then the C1 residual-gate conversions.
3. **2D-3**: W3 view permissions (SHADOW → NEW_ENFORCED), W1 manufacturer, W7.
4. **2D-4**: W4 identity permissions to NEW_ENFORCED, then W5 hierarchy
   protection.

## 4. Exit criteria for "Stage 2 complete"

- The inventory re-run shows **0 server-side legacy decisions** outside
  `legacy:` evaluators and the documented EXCEPTION.
- Every converted gate has parity `widen_if_converted = 0` on staging and a
  contract test.
- No permission remains in SHADOW, except by an explicit management decision.
- UI gates for Finance (and every module moved to W6) follow S&A.
- The staging UAT for each batch has passed, and the modes are recorded.
- The production readiness audit (Stage 3) can start. It needs read-only
  production access, which is still pending approval.

## 5. Out of scope here

- Any production change.
- `legacy_authorization.read_only` and LEGACY_RETIRED moves: Stage 3.
- Removing legacy evaluators: after LEGACY_RETIRED per permission.
