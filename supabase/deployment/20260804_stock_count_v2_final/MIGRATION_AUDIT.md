# Migration audit — Stock Count V2 / Inventory Opening Balance

Authoritative application commit: **`9a62556aae6f64af3bc98f159196179669311b3f`**
Audit date: 2026-08-04. Databases inspected **read-only** (`BEGIN READ ONLY`; a
`CREATE TABLE` probe was rejected by the engine, proving enforcement).

---

## A. Environment status at audit time

| | Staging | Production |
|---|---|---|
| PostgreSQL | 17.6 | 17.6 |
| `public` tables | 400 | 391 |
| Contract functions | 67 | 41 |
| Migration ledger (`supabase_migrations.schema_migrations`) | **absent** | **absent** |
| Opening Balance contract | **complete** (through `20260801250000`) | **materially behind** |

**Neither environment has a migration ledger.** Migrations are applied by hand, so
filenames prove nothing. Every conclusion below comes from inspecting live catalog
objects, not from file names or a ledger.

### Staging vs production delta

| Missing in production | Count |
|---|---|
| Tables | 8 (all policy / bulk / allocation ledgers) |
| Functions | 26 |
| CHECK values | 2 (`opening_balance_cutoff`, `do_not_carry_forward`) |
| Triggers | 1 (`inventory_cutoff_excluded_transaction_guard`) |
| Functions present but with an **older body** | 8 |

Production has **nothing** that staging lacks — it is a strict subset. Base table
columns are identical in both (121 columns compared across the 10 core tables), so
the delta is entirely the policy/allocation layer added late in development.

### Proof that staging equals the repository contract

Function bodies were extracted from staging with `pg_get_functiondef()`, normalised
(comments, whitespace and `$$` vs `$function$` delimiters removed) and compared with
the last-writer migration in the repository:

| Function | Result |
|---|---|
| `inventory_cutoff_preview` | **MATCH** |
| `verify_and_post_inventory_opening_cutoff` | **MATCH** |
| `verify_and_post_inventory_opening_cutoff_scoped_legacy` | **MATCH** |
| `bind_inventory_cutoff_verification_snapshot` | **MATCH** |
| `resolve_inventory_cutoff_allocation` | **MATCH** |
| `release_allocation_for_order` | **MATCH** |
| `archive_stock_count_draft` | **MATCH** |
| `cancel_inventory_opening_cutoff` | **MATCH** |
| `set_inventory_cutoff_decision` | **MATCH** |

> **Correction to an earlier report.** A previous session concluded that
> `20260801250000` had not been applied to staging. That is **no longer true** — the
> live staging body contains the 250000 gate
> (`d.decision in ('carry_forward','cancel_release') and o.status<>'submitted'`),
> so it has been applied since. Staging is at the full contract.

---

## B. ⚠ The `inventory_cutoff_preview` delegation chain

**This is the single most important finding in the audit.**

`inventory_cutoff_preview` is **not self-contained**. Development built it by
repeatedly renaming the live function to a `*_pre_<feature>` name and creating a thin
wrapper on top. The result is an **eight-layer stack** where each layer calls the one
below:

```
inventory_cutoff_preview                                   <- 20260801180000
  -> inventory_cutoff_preview_pre_blocker_details           (= 20260801140000 body)
       -> inventory_cutoff_preview_pre_transactions_policy  (= 20260801090000 body)
            -> inventory_cutoff_preview_pre_h2m_policy      (= 20260731230000 body)
                 -> inventory_cutoff_preview_pre_d2h_policy (= 20260731210000 body)
                      -> ..._pre_stock_adjustment_detail    (= 20260731190000 body)
                           -> ..._pre_stock_adjustment_eligibility (= 20260731_h2m body)
                                -> ..._h2m_unscoped_legacy  (= 20260726/05 body)
```

The `*_pre_*` functions look like dead clutter. **They are load-bearing.** A pack that
installed only the top-level function would compile without error and then fail at
**runtime** on the first preview call with `function ... does not exist`.

The same pattern applies to
`verify_and_post_inventory_opening_cutoff_pre_transactions_polic` — note the name is
**truncated at 63 characters** by PostgreSQL's identifier limit. That truncated
spelling is the real object name.

`04_functions_and_triggers.sql` installs all eight layers under their final names with
`CREATE OR REPLACE`, and replays **no** rename (renames are not rerunnable).

---

## C. ⚠ Migration filename ordering trap

Three migrations use a date-only prefix. `_` (0x5F) sorts **after** digits, so a naive
`ls` or `sort` orders them **wrongly**:

```
sort order (WRONG):  20260731173000_...  before  20260731_...
required order:      20260731_...        before  20260731173000_...
```

`20260731_inventory_cutoff_authoritative_h2m_incoming_resolver.sql` **creates** the
h2m bulk tables and functions that `20260731173000_...` then replaces. Running them in
filename order fails. This is one reason the fresh pack exists.

---

## D. 🔒 Security observation (not changed by this pack)

`anon` **can execute `inventory_cutoff_preview`** on staging today.

PostgreSQL grants `EXECUTE` to `PUBLIC` by default on every new function. Each
migration that replaced the preview granted `EXECUTE` to `authenticated` but revoked
`PUBLIC` only from the **renamed legacy copy**, never from the new function. So `anon`
inherits it — verified live: `has_function_privilege('anon', ..., 'EXECUTE') = true`.

This pack **does not change it**, because tightening it is a security decision beyond
the `9a62556a` contract and could break a caller you know about and I do not.
`08_post_deployment_verification.sql` reports it as `REVIEW_REQUIRED`, not `FAIL`.

**Recommended follow-up** (your decision, deliberately not included):

```sql
REVOKE ALL ON FUNCTION public.inventory_cutoff_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_cutoff_preview(uuid) TO authenticated;
```

---

## E. Files that must NEVER be deployed

**Schema snapshots / reference only** (describe a database, do not build one):

- `supabase/schemas/current_schema.sql`
- `supabase/schemas/current_schema_stg.sql`
- `supabase/schemas/pre_hq_warehouse_release_prod_20260720.sql`

**Diagnostic / verification SQL** (safe to read, never part of a deployment):

- `supabase/diagnostics/*.sql` (all)
- `scripts/verify_stock_config_migration.sql`
- `scripts/stock_config_staging_test_readiness.sql`
- `scripts/inspect_consumer_ledger_by_phone.sql`
- `docs/reporting-data-coverage-audit/*.sql`

**Archives and unrelated one-offs:**

- `supabase/migrations/production/**` — an archived historical dump. Despite living
  under `migrations/`, it is **not** a migration set.
- `docs/landingpage-modules/db-scripts/*.sql`
- `app/sql/user-shop-migration.sql`
- `docs/archive/INCENTIVE_SYSTEM_MIGRATION.sql`

**Non-SQL clutter inside `supabase/migrations/`:** `Untitled-1.ipynb`,
`sql chat chatgpt.rtf`, `serapod2u_main.code-workspace`.

---

## F. Unsafe / non-idempotent operations found in the original history

| Operation | Where | Why it matters | Handled in the pack by |
|---|---|---|---|
| `ALTER FUNCTION ... RENAME TO ..._pre_x` | 6 migrations | **Not rerunnable.** A second run renames the wrong function and corrupts the chain. | Not replayed; layers installed by final name with `CREATE OR REPLACE`. |
| `CREATE FUNCTION` (no `OR REPLACE`) after a rename | same 6 | Fails on re-run. | Same. |
| `ALTER TABLE ... DROP CONSTRAINT` then `ADD CONSTRAINT` | `20260801230000`, `.../05` | A window with **no** constraint; `ACCESS EXCLUSIVE` lock; full table re-validation. | Kept (unavoidable) but documented, and `01` pre-checks for rows that would fail. |
| Migration-time `UPDATE` | `20260730_archive_variant...`, `20260731220000` | Changes business data during a "schema" migration. | Moved into `06`, behind a read-only preview. |
| `CREATE UNIQUE INDEX` without a duplicate pre-check | `20260730_..._full_conflict_index` | Fails mid-deployment on dirty data. | `01` fails first with a clear reason. |

**Migrations that could partially apply:** all six rename-based ones, if run outside a
transaction. Every file in this pack is wrapped in a single transaction.

**SQL depending on staging-only data:** none found. No contract function contains a
hard-coded UUID, URL or connection string — verified by regex scan across all
contract functions on staging (0 matches).

---

## G. Full migration classification

`In pack = No` for the early foundation files means **they are already applied and
identical in both environments** — not that they are unnecessary. They are recorded
here as required history.

| # | Original migration | Purpose | Deps | Classification | In pack | Replacement | Reason / status | Risk |
|---|---|---|---|---|---|---|---|---|
| 1 | `20260712_stock_count_sessions.sql` | Stock Count session core tables | - | Required foundation | No | `(already live in BOTH envs)` | Pre-dates this release; present and identical in staging and production. | Low |
| 2 | `20260715_stock_count_verification_01.sql` | OTP verification request tables | 1 | Required foundation | No | `(already live in BOTH)` | Same. | Low |
| 3 | `20260715_stock_count_verification_02.sql` | Verification flow + hashing | 2 | Required foundation | No | `(already live in BOTH)` | Same. | Low |
| 4 | `20260716_stock_count_verification_preflight_and_permissions_03.sql` | Preflight + stock_count_user_can_post | 3 | Required foundation | No | `(already live in BOTH)` | Same. | Low |
| 5 | `20260716_stock_count_base_cost_snapshot_05.sql` | Base-cost snapshot on count items | 4 | Required foundation | No | `(already live in BOTH)` | Same. | Low |
| 6 | `20260717_stock_config_01_groundwork.sql` | inventory_stock_configurations groundwork | - | Required foundation | No | `(already live in BOTH)` | Same. | Low |
| 7 | `20260717_stock_config_02_core_ledger.sql` | Config-aware movement ledger | 6 | Required foundation | No | `(already live in BOTH)` | Same. | Low |
| 8 | `20260717_stock_config_03_ord_repack.sql` | Order + repack config handling | 7 | Required foundation | No | `(already live in BOTH)` | Same. | Low |
| 9 | `20260717_stock_config_04_stock_count.sql` | Stock count config scope + PARTIAL unique index | 7 | Required foundation | No | `03 (index superseded)` | Its PARTIAL unique index cannot serve ON CONFLICT; superseded by seq 33. | Med |
| 10 | `20260717_stock_config_05_so_fulfilment.sql` | allocate/release_allocation_for_order v1 | 7 | Superseded but historically required | No | `07` | release_allocation_for_order fully superseded by seq 51. | Med |
| 11 | `20260717_stock_config_06_views_reports.sql` | Reporting views | 7 | Required foundation | No | `(already live in BOTH)` | Same. | Low |
| 12 | `20260717_stock_config_08_initial_classification.sql` | Initial classification + stock_movements reference allowlist | 7 | Superseded but historically required | No | `03` | Its closed reference_type allowlist is superseded by seq 53. | Med |
| 13 | `20260718_stock_config_09_full_count_classification_guard.sql` | Full-count classification guard | 12 | Required incremental dependency | No | `(already live in BOTH)` | Present in both environments. | Low |
| 14 | `20260718_stock_config_10_repack_to_20nb.sql` | Repack to 20NB | 12 | Required incremental dependency | No | `(already live in BOTH)` | Same. | Low |
| 15 | `20260718_stock_config_11_transfer_workflow.sql` | Transfer workflow | 12 | Required incremental dependency | No | `(already live in BOTH)` | Same. | Low |
| 16 | `20260718_stock_config_13_manual_stock_addition.sql` | Manual stock addition | 12 | Required incremental dependency | No | `(already live in BOTH)` | Same. | Low |
| 17 | `20260719_stock_config_14_classification_post_grant.sql` | verify_and_post_stock_count final | 12 | Required incremental dependency | No | `(already live in BOTH)` | Final writer for verify_and_post_stock_count; unchanged by this release. | Low |
| 18 | `20260719_stock_config_16_classification_allocation_legacy_guards.sql` | Legacy allocation guards | 12 | Required incremental dependency | No | `(already live in BOTH)` | Same. | Med |
| 19 | `20260719_stock_config_17_discard_stock_count_drafts.sql` | archive_stock_count_draft v1 + discard_stock_count_drafts | 12 | Superseded but historically required | No | `04` | archive_stock_count_draft superseded by seq 47. | Med |
| 20 | `20260719_stock_config_18_classification_allow_physical_variance.sql` | Allow physical variance | 12 | Required incremental dependency | No | `(already live in BOTH)` | Same. | Low |
| 21 | `20260719_stock_config_19_collision_safe_stock_sku_generator.sql` | Collision-safe SKU generator | 12 | Required incremental dependency | No | `(already live in BOTH)` | Final writer for generate_stock_sku. | Low |
| 22 | `20260719_stock_config_20_view_contract_compatibility.sql` | View contract compatibility | 12 | Required incremental dependency | No | `(already live in BOTH)` | Same. | Low |
| 23 | `20260720_hq_warehouse_consolidated_inventory_02.sql` | HQ warehouse consolidated inventory | - | Required incremental dependency | No | `(already live in BOTH)` | Same. | Low |
| 24 | `20260723_stock_count_configuration_scope.sql` | Count configuration scope | 9 | Required incremental dependency | No | `(already live in BOTH)` | Same. | Low |
| 25 | `20260725_stock_count_classification_allocation_carry.sql` | Classification allocation carry; snapshot hash final | 24 | Required incremental dependency | No | `(already live in BOTH)` | Final writer for stock_count_snapshot_hash and verify_and_post_stock_classification. | Med |
| 26 | `20260726_inventory_opening_balance_cutoff/01_cutoff_foundation.sql` | Opening Balance cut-off core tables + freeze guards | 25 | Required foundation | No | `(already live in BOTH)` | Creates inventory_opening_cutoffs, decisions, reports, audit_events, posting_context. Present in BOTH envs. | Med |
| 27 | `20260726_inventory_opening_balance_cutoff/02_cutoff_preview_and_decisions.sql` | preview v1 + decisions | 26 | Superseded but historically required | No | `04 + 07` | preview superseded seven times; final is seq 48. | Med |
| 28 | `20260726_inventory_opening_balance_cutoff/03_cutoff_atomic_posting.sql` | Atomic posting v1 | 27 | Superseded but historically required | No | `07` | verify_and_post superseded; final is seq 45. | High |
| 29 | `20260726_inventory_opening_balance_cutoff/04_unified_opening_balance_flow.sql` | Unified OB flow; warehouse safety trigger | 28 | Required incremental dependency | No | `(already live in BOTH)` | Final writer for start_inventory_opening_cutoff and prepare_stock_count_verification. | Med |
| 30 | `20260726_inventory_opening_balance_cutoff/05_cutoff_do_not_carry_forward.sql` | 'do_not_carry_forward' decision + CHECK widening | 29 | Final corrective (partly superseded) | **Yes (partial)** | `03 (CHECK), 04 (chain base)` | Only its CHECK widening is applied directly; its function bodies are superseded. | Med |
| 31 | `20260727_stock_count_group_config_profile.sql` | Group config eligibility profile | 29 | Required incremental dependency | No | `(already live in BOTH)` | Present in both environments. | Low |
| 32 | `20260730_stock_count_reference_required.sql` | Mandatory Reference trigger | 26 | Final corrective | **Yes** | `04` | enforce_stock_count_reference_required + trigger. | Low |
| 33 | `20260730_stock_count_session_items_full_conflict_index.sql` | Non-partial unique index for ON CONFLICT | 9 | Final corrective | **Yes** | `03` | Supersedes the PARTIAL index from seq 9. | Med |
| 34 | `20260730_archive_variant_stock_config_reconciliation.sql` | Archived-variant config reconciliation | 6 | Data reconciliation | **Yes** | `06` | Migration-time UPDATE; idempotent, narrow allow-list. | **DATA** |
| 35 | `20260731_archive_product_variant_atomic.sql` | archive_product_variant() RPC | - | Final corrective | **Yes** | `04` | Sole definition. | Low |
| 36 | `20260731_inventory_cutoff_authoritative_carry_forward_resolver.sql` | D2H carry-forward resolver; renames post -> _scoped_legacy | 30 | Final corrective | **Yes** | `04` | resolve_inventory_cutoff_d2h_carry_forward is final here. Its RENAME is NOT replayed. | Med |
| 37 | `20260731_inventory_cutoff_authoritative_h2m_incoming_resolver.sql` | H2M resolver; set_inventory_cutoff_decision final; creates h2m_bulk tables | 36 | Final corrective | **Yes** | `02, 04` | Final writer for resolve_inventory_cutoff_h2m_incoming and set_inventory_cutoff_decision. RENAME not replayed. | Med |
| 38 | `20260731173000_inventory_cutoff_h2m_bulk_contract_targeting_fix.sql` | H2M bulk contract + targeting fix | 37 | Final corrective | **Yes** | `04` | Final writer for both h2m_bulk functions. MUST run after seq 37 (see ordering trap). | Med |
| 39 | `20260731190000_inventory_cutoff_stock_adjustment_activity_eligibility.sql` | Stock-adjustment eligibility in preview | 38 | Superseded but historically required | **Yes (as chain layer)** | `04` | Its preview body survives as inventory_cutoff_preview_pre_stock_adjustment_detail. | Med |
| 40 | `20260731210000_inventory_cutoff_stock_adjustment_activity_detail_category.sql` | Adjustment detail + category scope | 39 | Superseded but historically required | **Yes (as chain layer)** | `04` | Its preview body survives as inventory_cutoff_preview_pre_d2h_policy. | Med |
| 41 | `20260731220000_inventory_cutoff_cancel_archives_draft_session.sql` | Cancel releases the active draft slot + backfill | 40 | Final corrective | **Yes** | `04 + 06` | cancel_inventory_opening_cutoff final. Its backfill UPDATE moves to 06. | **DATA** |
| 42 | `20260731230000_inventory_cutoff_d2h_policy.sql` | D2H policy tables, RLS, preflight/apply | 41 | Final corrective | **Yes** | `02, 04, 05` | Final writer for the D2H policy functions. Its preview body survives as _pre_h2m_policy. | Med |
| 43 | `20260801090000_inventory_cutoff_h2m_policy.sql` | H2M policy tables, RLS, receipt guard | 42 | Final corrective | **Yes** | `02, 04, 05` | Final writer for H2M policy + warehouse-receipt guard. Its preview body survives as _pre_transactions_policy. | Med |
| 44 | `20260801120000_inventory_cutoff_pre_otp_draft_discard.sql` | Pre-OTP drafts remain discardable | 43 | Superseded (partly) | **Yes (partial)** | `04` | stock_count_discard_posting_started_guard is final here; its archive_stock_count_draft is superseded by seq 47. | Med |
| 45 | `20260801140000_inventory_cutoff_transactions_policy.sql` | Transactions policy tables + excluded-transaction guard | 44 | Final corrective | **Yes** | `02, 04, 05, 07` | Final writer for verify_and_post_inventory_opening_cutoff. Its preview body survives as _pre_blocker_details. | High |
| 46 | `20260801160000_inventory_cutoff_blocker_details.sql` | Structured blocker_details[] contract | 45 | Superseded | No | `07` | Its preview body has a nested-aggregate bug; fully superseded by seq 48. Its RENAME is reproduced by name in 04. | Med |
| 47 | `20260801170000_inventory_cutoff_pre_otp_discard_transactions_policy.sql` | Discard also clears Transactions policy children | 46,45 | Final corrective | **Yes** | `04` | Final writer for archive_stock_count_draft. | Med |
| 48 | `20260801180000_inventory_cutoff_preview_nested_aggregate_fix.sql` | Fixes 'aggregate calls cannot be nested' in preview | 47 | Final corrective | **Yes** | `07` | **Terminal inventory_cutoff_preview.** Thin wrapper over the chain. | High |
| 49 | `20260801190000_inventory_cutoff_allocation_resolver.sql` | Allocation reconciliation resolver + requests table | 48 | Superseded (partly) | **Yes (partial)** | `02` | Its table is used; its resolver body is superseded by seq 52. | Med |
| 50 | `20260801200000_fix_d2h_cancel_legacy_null_config_allocation_release.sql` | Release when order_items.stock_config_id IS NULL | 10 | Superseded | No | `07` | Fully superseded by seq 51, which handles the NULL *movement* case too. | Med |
| 51 | `20260801210000_fix_d2h_cancel_null_config_movement_variant_default.sql` | Release when the allocation MOVEMENT is NULL-config | 50 | Final corrective | **Yes** | `07` | **Terminal release_allocation_for_order.** | High |
| 52 | `20260801220000_fix_inventory_cutoff_allocation_resolver_frozen_release.sql` | Freeze-aware allocation release | 49 | Final corrective | **Yes** | `07` | **Terminal resolve_inventory_cutoff_allocation.** | High |
| 53 | `20260801230000_allow_opening_balance_cutoff_stock_movement_reference.sql` | Adds 'opening_balance_cutoff' to the reference allowlist | 52,12 | Final corrective | **Yes** | `03` | DROP + ADD CHECK on stock_movements. ACCESS EXCLUSIVE lock. | **LOCK** |
| 54 | `20260801240000_opening_balance_post_allows_review_required.sql` | Post gated by real blockers only | 53 | Final corrective | **Yes** | `07` | **Terminal bind_inventory_cutoff_verification_snapshot.** Its _scoped_legacy is superseded by seq 55. | High |
| 55 | `20260801250000_opening_balance_post_excluded_d2h_order_status_tolerance.sql` | do_not_carry_forward survives later order cancellation | 54 | Final corrective | **Yes** | `07` | **Terminal verify_and_post_inventory_opening_cutoff_scoped_legacy.** | High |


### Summary

| Classification | Count |
|---|---|
| Required foundation (already live in both) | 8 |
| Required incremental dependency (already live in both) | 14 |
| Superseded but historically required | 8 |
| Fully superseded — excluded from the pack | 3 |
| Final corrective — included | 19 |
| Data reconciliation | 2 (rows 34, 41 — both routed to `06`) |
| Diagnostic / snapshot — never deployed | see §E |

**Fully superseded and deliberately excluded:** `20260801160000` (nested-aggregate
bug, replaced by `20260801180000`), `20260801200000` (replaced by `20260801210000`),
and the `verify_and_post` body in `20260726/03` (replaced by `20260801140000`).

**Terminal (last-writer) definitions — the contract this pack installs:**

| Object | Final definition from |
|---|---|
| `inventory_cutoff_preview` | `20260801180000` |
| `verify_and_post_inventory_opening_cutoff` | `20260801140000` |
| `verify_and_post_inventory_opening_cutoff_scoped_legacy` | `20260801250000` |
| `bind_inventory_cutoff_verification_snapshot` | `20260801240000` |
| `resolve_inventory_cutoff_allocation` | `20260801220000` |
| `release_allocation_for_order` | `20260801210000` |
| `archive_stock_count_draft` | `20260801170000` |
| `cancel_inventory_opening_cutoff` | `20260731220000` |
| `stock_count_discard_posting_started_guard` | `20260801120000` |
| `set_inventory_cutoff_decision` | `20260731_..._h2m_incoming_resolver` |
| `resolve_inventory_cutoff_h2m_incoming` | `20260731_..._h2m_incoming_resolver` |
| `resolve_inventory_cutoff_d2h_carry_forward` | `20260731_..._carry_forward_resolver` |
| `inventory_cutoff_h2m_bulk_preflight` / `apply_...` | `20260731173000` |
| D2H policy functions | `20260731230000` |
| H2M policy functions | `20260801090000` |
| Transactions policy functions | `20260801140000` |
| `archive_product_variant` | `20260731_archive_product_variant_atomic` |
| `enforce_stock_count_reference_required` | `20260730_stock_count_reference_required` |

---

## H. Rehearsal evidence

The pack was executed against a **disposable local PostgreSQL cluster** restored from
a read-only `pg_dump --schema-only` of **production** (380 of 391 tables restored;
the shortfall is PostgreSQL 17 → 14 syntax differences in the local rehearsal, not
missing contract objects).

| Run | Result |
|---|---|
| `01`–`09` in order, fresh production baseline | **all PASS** |
| Second consecutive run of every file | **all PASS** (rerunnable) |
| `08` on the deployed rehearsal database | **80 PASS, 0 FAIL, 1 REVIEW_REQUIRED** (the documented `anon` grant) |
| `_pre_*` chain present after deployment | 8 / 8 |
| Ambiguous overloads after deployment | 0 |

**Rehearsal limitation, stated honestly:** the disposable cluster is PostgreSQL
**14.19**, while staging and production run **17.6**. This validates syntax,
dependency order, idempotency and object creation, but cannot prove behaviour that is
version-specific. No rehearsal was performed against live staging or production.
