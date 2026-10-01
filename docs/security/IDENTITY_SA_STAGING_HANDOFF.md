# Identity / Security & Access — staging hand-off for management testing

Date: 2026-09-29 · Canonical branch: `security/identity-foundation-finalization`
Staging: **`d06e38a3`** (Coolify deployment finished, container healthy,
`/api/health` 200). The branch is one documentation-only commit ahead of `staging` (this hand-off and the post-migration verify script).

**Production: untouched.** No production reads, writes, migrations, mode
changes or deployments were made in this program. `main` is unchanged.

## 1. What is on staging

| Stage | Content | State on staging |
|---|---|---|
| Stage 1 | Central identity (one human = one identity), provisioning service, protected identity fields, history-preserving delete, canonical staff classification | Migrations run; UAT verified |
| Stage 2 | HR as the employment source, archive keeps identifiers, identifier drift sync and uniqueness, suspension preserves access | Migrations run; UAT verified |
| Stage 2C | 45 server-side legacy role decisions converted to S&A | Deployed. The signed-in UAT (part B) never appeared in the decision log, so it is **unverified** |
| Stage 2D | The 53 deferred decisions plus the Outdoor store staff rule; organization-readable scope; target protection; browser capability endpoint; Finance UI gates; HR→GL read authorization | App deployed. **Migration pending (section 2)** |

Also on staging with this commit:

- The canonical branch was reconciled with staging (merge `408781dc`); no
  staging commit was lost (0 staging commits missing, verified by `git rev-list`).
- It carries ten `main` commits that staging had never received:
  - email OTP deliverability and email monitor entries;
  - the Add Stock configuration-filter fix;
  - the payment-request read-boundary and audit-history migrations, whose
    effects were already present in the staging database;
  - the Phase 0A/0B hardening commits, already on staging in adapted form.

  All of these are already live in production.
- The teammates' storefront and Outdoor work is preserved unchanged.

## 2. Migration management must run on staging

| # | File | Purpose |
|---|---|---|
| 1 | `supabase/migrations/20260930100000_sa_stage2d_deferred_closure.sql` | `sa_readable_organizations`, `sa_actor_dominates`, and 13 new permissions in **SHADOW**. Each permission has a named role, backfilled to exactly today's legacy audience (about 382 assignments on staging: 3–54 per role). No mode is enforced. |

- Run the file as a whole. It is idempotent and autocommit-safe.
- Its post-conditions check the backfill parity and that readable
  organizations match the evaluator.
- A re-run never re-grants an assignment an administrator ended.
- Rehearsed on local replicas in both the production-like and the staging
  state: the identity suite passes (318 checks production-like), and the new
  `95_stage2d_closure.sql` passes 30/30 in both states.
- Afterwards run `supabase/diagnostics/identity_stage2d_post_migration_verify.sql`
  (read-only) and send the output for verification.

No other migration is needed for this program. Storefront and Outdoor
migrations belong to their owners. During testing, `public.system_preferences`
was reported missing in the staging database logs; that is outside this
program.

Before the migration, the application keeps every new permission on its
legacy rule. The deploy changes nothing until the migration runs and
management enforces.

## 3. Mode decisions for management (after the migration, in the S&A console)

Each key moves SHADOW → NEW_ENFORCED only after its parity shows no
unexplained mismatch (query 4 of the verify script):

- **The 13 Stage 2D permissions:**
  - `customer.support.administer`, `customer.report.view`,
    `customer.messaging.manage`, `customer.banner.manage`;
  - `manufacturing.adjustment.administer`, `platform.user.profile_edit`,
    `hr.employee.view_internal`;
  - `customer.crm.view`, `marketing.module.view`, `product.catalog.view`,
    `ecommerce.module.view`, `ecommerce.outdoor.operate`,
    `platform.notification_monitor.view`.
- **The 4 identity permissions** (`platform.identity.view`, `.disable`,
  `.delete`, `platform.identity_access.manage`):
  - enforcing `platform.identity.delete` and `platform.identity_access.manage`
    also switches delete and password-reset target protection to "the actor
    must hold every grant of the target";
  - `platform.identity.delete`'s compatibility audience is Super Admin only;
    HQ admins keep delete while it is in SHADOW.

After enforcement, access is granted or removed per person through the named
roles in Security & Access, for example:

- Support Inbox Administrator;
- Outdoor Store Operator;
- Internal Directory Viewer.

The legacy role code no longer decides.

## 4. What to test (staging, signed in)

Use a Super Admin, an HQ admin, a power user, an HQ manager/user, a warehouse
user, a distributor or shop user, the QA identities (QA-E: baseline only;
QA-H: consumer) and a consumer.

For each item, first confirm today's behaviour is unchanged. After enforcing
the key, confirm that granting or removing its role in S&A changes access
accordingly.

**HR**
- Departments and org chart: create, edit, move.
- Positions: create and edit.
- HR settings: save.
- Employee HR details:
  - editing an employee in a DIST organization under HQ works;
  - editing one in an unrelated organization is refused.
- HR assistant:
  - salary answers only for HR-manager access;
  - personal fields for HR staff;
  - internal fields (work email, hire date) for the internal-directory viewer.
- KPI review "request changes": only HR managers or review approvers.

**Finance**
- HR → Accounting (GL mappings): view, apply template, set up defaults, save a
  mapping. This now requires `finance.payroll_integration.manage` or
  `finance.ledger.view` for the organization.
- Accounting settings, Chart of Accounts, Default Accounts, Posting Rules,
  Currency settings: the manage buttons follow S&A.
- GL Journal and Pending Postings: the post buttons follow
  `finance.journal.post`.
- Order balance payment request: the Approve button follows
  `finance.payment.approve`.

**Supply chain / warehouse**
- Warehouse pending receives, scan history, intake history:
  - Super Admin without a warehouse selected sees every warehouse, as today;
  - after the migration, S&A readable organizations decide.
- Confirm a staging test shipment.
- Supply Chain → Inventory settings page: follows
  `inventory.stock_config.manage`.
- Manufacturer quality issues and adjustments:
  - manufacturers see their own;
  - adjustment administrators see and assign all.

**Customer / CRM / loyalty**
- Support inbox: conversations, threads, reply, blasts, tags, admins.
- CRM reports: shop staff performance, consumer performance, shop consumers,
  shop points report.
- Journey create, update, duplicate and delete.
- Loyalty memberships lookup.
- Consumer app regression:
  - points, history and rewards;
  - scan and collect, redeem;
  - shop link.

**E-commerce / Outdoor / marketing**
- Master banner.
- E-Commerce and Marketing module entry.
- Outdoor staff desk: fulfilment, products, product images, customer updates,
  requests, EasyParcel connect.
- Message setup short links and preview.
- WhatsApp marketing audience resolve.
- Catalogue module entry.

**Platform / identity**
- User Management: add, edit, deactivate, archive and reactivate.
- Editing another person's profile.
- Delete-user OTP request and confirm: a lower-privilege admin cannot delete a
  higher one.
- Password reset.
- Organization delete (OTP) and organization import.
- Admin states.
- Super Admin data tools: export, restore, cleanup reports, deletion
  notification, template preview, document migration.
- Email and SMS delivery monitors.
- Settings → Authorization shows the read-only legacy view.
- Security & Access console:
  - the 13 new permissions and roles are visible;
  - modes can be changed;
  - the decision log shows SHADOW comparisons.

## 5. Known limitations

1. **Stage 2C signed-in UAT unverified.** Three reported part-B runs left no
   rows in the S&A decision log (no Super Admin or QA-E decisions). The
   read-only decision matrix passed 165/165.
2. **`/api/orders/actors`** stays a documented EXCEPTION. It is a
   relation-based read; orders row-level security enforces tenancy.
3. **Dead routes** still on staging, all non-functional:
   - `admin/whatsapp/{settings,admins,admins/[id]}` select a column that does
     not exist;
   - `ai/metrics` reads a table that does not exist;
   - `wa/marketing` `SUPER_ADMIN` branches check a role code that does not exist;
   - the `/journey-builder` page always redirects.

   A separate task is removing or fixing them. It had not finished at hand-off.
4. **Alert recipients** for shop requests and RoadTour claims are still chosen
   by legacy role (who receives admin alerts). This is not an access check.
5. **UI gates outside Finance** (about 160 client occurrences) still read the
   legacy level. The server decides every operation. The capability endpoint
   and hook are in place for converting them module by module.
6. **Database-level legacy helpers** (`is_hq_admin()`, `get_my_role_level()`
   in RLS/RPC) remain behind the S&A gates. Retiring them is Stage 3
   (LEGACY_RETIRED).
7. **Scope semantics once enforced.**
   - HQ-scoped holders see their whole organization subtree (warehouses,
     distributors, shops).
   - "Super Admin sees everything" becomes "sees everything in its scope"
     (on staging, one manufacturer organization has no parent and is outside
     HQ's scope).
8. **`bulk-delete-users`** is disabled on staging by its environment gate
   (`ALLOW_DESTRUCTIVE_DB_OPS` unset). Its verified-session fix is covered by
   tests, not by a live run.
9. **Storefront shopper data** (orders, requests, checkout prefill) is matched
   by email, not identity id. This is the storefront feature's design; it
   conflicts with "email is an identifier, never a key".
10. **Three inventory UI test files** fail on staging as before this program
    (`stock-config-operational-ui-contract`, two stock-count/movement suites).
11. **Short-links list fail-closed:** an admin without an organization now sees
    no short links instead of all.

## 6. Not done (by instruction)

- No production preparation, migration list for production, or deployment.
- No mode changes.
- No merge to `main`.
