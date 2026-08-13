# Device Standard stock configuration repair — production execution package

**Date:** 2026-08-13 · **Branch:** `fix/device-standard-stock-config` (based on `origin/main` @ `9ffe1b63`)

Version-controlled equivalents (apply these to staging / any other environment
through the normal migration path — migrations are **never** applied
automatically by any deploy flow):

| Production script | Repo migration |
|---|---|
| `B1_APPLY_repair_device_std.sql` | `supabase/migrations/20260813120000_device_standard_stock_config_repair.sql` |
| `B2_APPLY_purge_device_concentration_configs.sql` | `supabase/migrations/20260813120100_device_remove_concentration_stock_configs.sql` |

Contract tests: `app/src/lib/inventory/device-standard-stock-config-sql.test.tsx`.

---

## The problem

A Device (S.Box / S.Line) has no nicotine volume and no box packaging version.
Its only valid stock configuration is the dimensionless Standard row that
`create_default_stock_config_for_variant()` creates for every new variant.
`20NB` / `50NB` / `50OB` describe a *liquid* and belong to Cartridge variants
only.

The Cellera concentration rollout was applied to Device variants by mistake.
`_enable_variant_stock_configurations_core()` therefore did two things to every
affected Device variant:

1. rewrote its `STD` row into `UNCLASSIFIED` / `phase_out` / `allow_ord = false`;
2. created phantom `20NB` / `50NB` / `50OB` rows (later deactivated by 20260727).

Quick/Standard Order and D2H only sell a configuration whose `status = 'active'`
and `allow_so` is true (`app/src/lib/orders/quick-order-catalog.ts`). Both
damaged states fail that test, so **D2H sellable availability reads 0 while the
stock physically exists**.

Verified against production on 2026-08-13 (read-only): **13,607 units** of
Device stock across 83 `product_inventory` rows, **0 sellable**.

## Run order

```
A_PRECHECK_read_only.sql                     -- read-only, send output back
B1_APPLY_repair_device_std.sql               -- only after A is confirmed
B2_APPLY_purge_device_concentration_configs.sql  -- only after B1 commits
D_APPLY_release_phantom_stockcount_refs.sql  -- ONLY if B2 reported BLOCKED, and
                                             -- only with business approval to
                                             -- delete the archived rows
B2_APPLY_purge_device_concentration_configs.sql  -- re-run after D
C_POST_VERIFICATION_read_only.sql            -- read-only
```

**Status on production as of 2026-08-13:** A reviewed, B1 committed (14 rows
repaired, D2H sellability restored), B2 run and correctly aborted with all 36
rows reported. D is written and validated but **not run** — it awaits the
business decision described below.

Both read-only scripts set `default_transaction_read_only = on`, so "read-only"
is enforced by the server rather than by inspection. Both apply scripts are a
single explicit transaction, take `SHARE ROW EXCLUSIVE` on
`inventory_stock_configurations`, re-run every safety assertion **inside** that
transaction, back up every row they touch into
`public._backup_device_stock_config_20260813`, verify before `COMMIT`, and
`ROLLBACK` everything on any assertion failure.

## What A_PRECHECK found in production (2026-08-13)

| Classification | Rows |
|---|---|
| `SAFE_RENAME_UNCLASSIFIED_TO_STD` | 12 |
| `SAFE_ACTIVATE_EXISTING_STD` | 2 |
| `BLOCKED_REFERENCED_LIQUID_CONFIG` | 36 |
| `SAFE_DELETE_UNREFERENCED_LIQUID_CONFIG` | 0 |
| `BLOCKED_DUPLICATE_GENERIC_CONFIG` / `BLOCKED_DUPLICATE_STD` / `UNEXPECTED_STATE` / `ALREADY_CORRECT` | 0 |

Re-run A yourself before applying — the classification is recomputed from live
data, and B1/B2 re-assert it independently rather than trusting this table.

## Why B1 and B2 are separate transactions

**B2 will abort on production today.** All 36 phantom Device concentration rows
are referenced by two *archived, never-posted* stock-count sessions
(`initial_configuration_classification` and `opening_balance_cutoff`, all
counted quantities zero) through `stock_count_session_scope` and
`stock_count_session_items`.

They cannot be deleted, and their references cannot be consolidated onto the
variant's Standard row either:

* `stock_count_session_items` is `UNIQUE (session_id, stock_config_id)`
  (`stock_count_session_items_session_config_unique_full`);
* `stock_count_session_scope`'s primary key is `(session_id, stock_config_id)`.

Every one of those sessions also scoped the same variant's generic row, so
**every** repoint collides with a row that already exists. Resolving a collision
means merging or discarding counted rows — rewriting stock-count history. That
is a business decision, so B2 refuses and reports instead.

Keeping B1 separate means that refusal costs nothing: B1 is already committed,
and it alone restores sellability. B2 is worth running purely to obtain the
authoritative list of records requiring manual treatment.

B1 therefore gates on `BLOCKED_DUPLICATE_GENERIC_CONFIG`,
`BLOCKED_DUPLICATE_STD` and `UNEXPECTED_STATE`, but **not** on
`BLOCKED_REFERENCED_LIQUID_CONFIG` — that classification describes a different
row, which B1 neither reads for update nor modifies. Gating B1 on it would mean
the fix could never be applied at all.

### To unblock B2 — script D

`D_APPLY_release_phantom_stockcount_refs.sql` removes exactly the rows that
block B2: the 60 `stock_count_session_scope` and 24 `stock_count_session_items`
rows that reference a phantom Device configuration. Every other row in those
sessions — every Cartridge row, and every row for the Device variants' own
Standard configuration — is left untouched.

**D is the only script in this package that deletes history.** It refuses to run
unless all of the following hold, each re-asserted inside its transaction:

* every affected session is `archived`, with `posted_at` and `posted_by` NULL;
* every session aggregate is already zero (`total_variants_counted`,
  `variance_items`, `net_quantity_adjustment`, `estimated_adjustment_value`);
* every item row carries no counted data — `system_quantity` 0,
  `adjustment_quantity` 0, `note` empty, and `physical_quantity` **IS NULL**.
  A physical count of *zero* is a real count and blocks the script;
* no `inventory_opening_cutoffs`, `stock_count_verification_requests` or
  `stock_count_classification_allocation_resolutions` row references an affected
  session;
* **nothing** has a foreign key to `stock_count_session_items` /
  `stock_count_session_scope`, and neither has a DELETE-firing trigger. Both are
  checked dynamically against `pg_constraint` / `pg_trigger`, so a future
  migration that adds either one invalidates this script instead of silently
  orphaning data.

All of these were verified true on production on 2026-08-13. Rows are copied
verbatim into `_backup_phantom_scope_20260813` / `_backup_phantom_items_20260813`
before deletion. (24 item rows carry a `unit_cost` snapshot; at zero quantity it
contributes zero value, and it is preserved in the backup.)

Run order once you have approval: **D**, then **B2**, then **C**.

## Reference coverage

All ten FK columns that can point at a stock configuration were enumerated from
`pg_constraint` on the live production catalog, not assumed:

`product_inventory`, `stock_movements`, `order_items`,
`warehouse_receipt_items`, `stock_adjustment_items`,
`stock_count_session_items`, `stock_count_session_scope`,
`stock_count_classification_allocation_resolutions` (`target_stock_config_id`),
`inventory_cutoff_decisions`, `inventory_cutoff_allocation_requests`.

There is no non-FK reference to reconcile: every other `%stock_config%` column
in the schema is `product_groups.stock_config_profile` (a group attribute) or
`order_items.stock_config_confirmed_at/by` (audit stamps on the row that already
carries `stock_config_id`). Stock transfers and repacking carry their
configuration through `stock_movements`, which is covered.

## Scope

"Device" is resolved structurally, never by product or variant name:

```sql
products.is_vape = true
AND COALESCE(product_groups.stock_config_profile, 'standard') = 'standard'
```

That is exactly `DEV-819958` (S.Box, S.Line) in production. Cartridge
(`concentration`) groups are excluded, and so are non-vape standard groups
(Speaker, Camping, Cat Treat) — Cat Treat has two deliberately inactive `STD`
rows that are **not** part of this incident and must not be activated.

## What is NOT changed

* No quantity, allocation, unit cost, movement or stock-count row.
  B1 and B2 both assert `sum(quantity_on_hand)` and `sum(quantity_allocated)`
  are identical before `COMMIT`.
* No Cartridge configuration. B1 compares an md5 fingerprint of every
  concentration-group configuration before and after; B2 compares their count.
* `stock_sku`. It is a business identifier snapshotted into
  `stock_count_session_items.sku` and exported, and it is not part of the
  required invariant. Rows repaired from `UNCLASSIFIED` keep their `-UNC-` SKU
  segment while carrying `config_code = 'STD'`. Say the word if you want that
  renamed — it is a separate, deliberate change.

## Recurrence guard

B1 redefines `_enable_variant_stock_configurations_core()` to resolve the
group's `stock_config_profile` and raise **before** touching the variant's
Standard row:

```
ERROR:  Concentration stock configurations (20NB/50NB/50OB) cannot be enabled
        for variant <uuid>: its product group profile is standard. Devices and
        other non-flavour groups keep exactly one dimensionless Standard (STD)
        configuration.
HINT:   Set product_groups.stock_config_profile = 'concentration' for genuine
        Cartridge/liquid groups only.
```

This complements — does not replace — the 20260727 row-level trigger
`assert_stock_config_group_eligibility()`. That trigger only fires on the
`INSERT`, by which point the `STD` → `UNCLASSIFIED` conversion has already run.
Raising earlier is what guarantees a Device `STD` can never be converted again.
Both profiles (`transition`, `new_standard`) are guarded, since both create at
least `20NB`. Genuine Cartridge variants are unaffected.

## After applying — UI behaviour

**A browser refresh is enough. No cache purge and no application restart.**

Stock configurations are read live from Postgres on every request — there is no
`unstable_cache`, no `revalidateTag`, and no client-side `staleTime` anywhere in
the inventory or order paths (`standard-order-catalog.ts`,
`quick-order-catalog.ts`, `api/orders/d2h/preflight`,
`api/inventory/stock-configurations/...` all query Supabase directly). Lifecycle
will show `active` on the next page load.

## Validation performed

* Live production schema, constraints, indexes, triggers and function bodies
  read directly from `serapod-prd-db` (read-only) — no column name in these
  scripts is speculative.
* `A_PRECHECK` and `C_POST_VERIFICATION` executed against live production
  read-only: 0 errors.
* `B1` / `B2` and both repo migrations executed against a throwaway PostgreSQL 17
  cluster loaded with a fixture reproducing the production states exactly
  (`UNCLASSIFIED`+`phase_out`, `STD`+`inactive`, referenced and unreferenced
  phantom rows, a genuine Cartridge variant, a non-vape standard variant).
  Verified: correct in-place repair, correct abort with full per-table counts,
  correct deletion once references are gone, idempotent re-runs, quantities
  unchanged, Cartridge untouched, and all four `UNEXPECTED_STATE` assertions
  firing.
* Recurrence guard verified in both directions: rejects Device (`transition` and
  `new_standard`) and non-vape standard groups without mutating the `STD` row;
  still creates the full concentration set for a genuine Cartridge variant.
* `D` validated on the same fixture: the full **D → B2** sequence leaves every
  Device variant with exactly one active `STD`, Cartridge untouched, quantities
  identical, and the non-phantom scope/item rows intact. All seven of its abort
  paths were exercised and each rolled back completely — session not archived,
  session already posted, non-zero session aggregates, a real physical count, an
  operator note, a dependent opening-cutoff, and a newly added foreign key.
* `npx vitest run src/lib/inventory src/lib/orders` — 1124 tests, 93 files, all
  passing.
