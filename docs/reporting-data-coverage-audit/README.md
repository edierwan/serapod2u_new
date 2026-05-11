# Serapod2U Reporting Data Coverage Audit

Date: 2026-05-09

## Purpose

This audit is a read-only production data coverage review for Serapod2U reporting.

It was created to answer one question before building new Shop Performance and Consumer Analytics management reports:

- What data still exists when `shop_id` is missing?
- What data still exists when `consumer_id` is missing?
- Can either of those missing fields be recovered safely from current production data?

This package does not change data, does not backfill data, does not create migrations, and does not change application behavior.

## What Was Checked

The audit checks the production reporting dataset using only read-only queries against the current scan and reference tables.

Checked areas:

- Overall non-manual scan coverage.
- Monthly coverage trends.
- Coverage by `claim_lane`.
- Breakdown of rows missing `shop_id`.
- Breakdown of rows missing `consumer_id`.
- Potential shop attribution recovery paths.
- Potential consumer identity recovery paths.
- Shop organization field completeness.
- Regional reporting readiness based on state and branch.
- Safe sample rows for manual inspection.

## Why Missing `shop_id` Matters

Shop Performance management reporting depends on attributed shop activity.

If `shop_id` is missing, the scan can still be useful for:

- total scan volume
- product engagement
- QR-level product or variant analysis
- consumer-level analysis when `consumer_id` exists

But it cannot be safely used for:

- shop leaderboards
- shop-level trend reporting
- regional shop rollups
- shop outreach or dormant-shop reporting
- shop performance benchmarking

Observed production result:

- `67,712` non-manual scan rows exist.
- Only `7,306` have `shop_id`.
- `60,407` are missing `shop_id`.
- Those missing-shop rows are entirely consumer-lane rows in the current production dataset.

## Why Missing `consumer_id` Matters

Consumer Analytics management reporting depends on stable consumer identity.

If `consumer_id` is missing, the scan can still be useful for:

- total scan volume
- product engagement volume
- shop-attributed traffic when `shop_id` exists

But it weakens or blocks:

- unique consumer counts
- consumer retention
- repeat-consumer analysis
- identified consumer leaderboards
- person-level CRM or lifecycle segmentation

Observed production result:

- `26,544` non-manual scan rows have `consumer_id`.
- `41,169` are missing `consumer_id`.

## Key Findings

### 1. Why `shop_id` is missing for most scans

The missing-shop rows are not empty rows. They still retain strong QR and product context.

From the current production audit:

- All `60,407` missing-shop rows still have `qr_code_id`.
- All `60,407` missing-shop rows still resolve to `product_id`, `variant_id`, and `order_id` through `qr_codes`.
- `19,350` of those rows still have `consumer_id`.
- More than `47k` of those rows also have QR-level consumer name, phone, and email on the linked `qr_codes` record.

But the missing-shop rows do not carry a reliable shop organization path:

- `qr_codes.current_location_org_id` is empty for those rows.
- Order-linked organization fields point to manufacturer and warehouse context, not to the scanning shop.
- Missing-shop rows are all `claim_lane = 'consumer'` in the current production dataset.

Business meaning:

- The rows are still useful for product and consumer analysis.
- They are not safe for shop management reporting.

### 2. What missing-shop rows still have

Rows missing `shop_id` still preserve:

- scan timestamp
- claim lane
- QR code
- product and variant via QR
- order via QR
- points amount
- collected-points flag
- IP address and user agent when populated
- consumer identity for a subset of rows
- QR-level fallback consumer fields for many rows

This means missing-shop rows are analytically useful, but not for shop attribution.

### 3. Whether `shop_id` can be recovered from existing data

Current answer: no for most rows.

Reason:

- The strongest available joins only recover QR, product, variant, order, manufacturer, and warehouse context.
- They do not recover the actual scanning shop organization.
- No stable `shop_org_id` style fallback was found for the missing-shop population.

Practical conclusion:

- Product lineage is recoverable.
- Shop attribution is not recoverable from current production data for the large missing-shop population.

### 4. Why `consumer_id` is missing for many scans

The missing-consumer rows are also not empty rows.

From the current production audit:

- All `41,169` missing-consumer rows still have `qr_code_id`.
- All `41,169` still resolve to product and variant through `qr_codes`.
- `27,988` have QR-level consumer email.
- `27,984` have QR-level consumer name.
- `27,935` have QR-level consumer phone.
- `112` missing-consumer rows still have `shop_id`.

On the scan row itself, fallback consumer fields are not useful in current production reporting.

Business meaning:

- The missing-consumer population is partly anonymous at the scan-event layer.
- But a material subset still has identity clues on the linked QR record.

### 5. Whether anonymous scans have fallback name, phone, or email

At the scan-event layer:

- scan-row fallback consumer fields are not reliable for current reporting needs.

At the linked QR layer:

- many missing-consumer rows still have QR-level consumer name, phone, and email.
- exact user matches are possible for `27,988` missing-consumer rows using those QR-level fallback values.

Important caveat:

- those fallback values live on `qr_codes`, not on the immutable scan-event row.
- that makes consumer recovery partial, not fully trustworthy for event-grade backfill logic.

### 6. Whether state/branch is ready for regional reporting

State and branch are much more complete than region and city.

Observed shop organization completeness:

- `762` total shops.
- `756` shops have `state_id` and state name.
- `753` shops have branch.
- only `160` shops currently resolve to region name.
- only `6` shops have city.

Business meaning:

- state-based and branch-based regional views are feasible.
- region-name reporting is not consistently ready.
- city-based reporting is not ready.

## Which Reports Are Safe Now

Safe now, with normal caveats:

- Recent-period shop reporting built only from rows with `shop_id`.
- Recent shop leaderboard and drill-down analysis for the attributed subset.
- Shop contact and dormant-shop monitoring for the attributed subset.
- Consumer analytics for identified consumers only.
- Product engagement reporting using QR, product, and variant joins.

## Which Reports Need Caveats

Needs explicit caveats:

- Any shop report described as network-wide or historically complete.
- Any shop trend report spanning months where shop attribution is materially incomplete.
- Any consumer report that implies full-population identity coverage.
- Any regional report using `region_name` rather than state or branch.

## Which Missing Fields May Be Recoverable

May be partially recoverable:

- `consumer_id` for part of the missing-consumer population, using QR-level consumer email or phone matching to `users`.
- product and variant context for missing-shop and missing-consumer rows through `qr_codes`.
- order lineage for missing-shop rows through `qr_codes.order_id`.

Recovery risk remains material because:

- QR-level consumer fields are not the same as event-level consumer identity.
- phone and email matching can be stale, duplicated, or overwritten.

## Which Missing Fields Are Not Recoverable From Current Data

Not recoverable with acceptable confidence from the current production model:

- `shop_id` for the large missing-shop population.
- full event-grade consumer identity for rows where only QR-level fallback data exists.
- region reporting for the full shop network using `region_name`.
- city-based shop reporting.

## Recommendation Before Building Shop Performance Management Reports

Recommendation:

- Build Shop Performance management reports only on the attributed shop subset.
- Label the scope clearly as shop-attributed activity.
- Use 7-day, 30-day, and 90-day windows by default.
- Do not present the result as a complete shop-network truth source.
- Do not attempt to infer `shop_id` from current QR or order relationships for production reporting.

If a later project wants broader historical shop reporting, that should start with attribution instrumentation and data-governance work, not with reporting-layer inference.

## Files In This Package

- `docs/reporting-data-coverage-audit/reporting_data_coverage_audit.sql`
- `docs/reporting-data-coverage-audit/manual_verification_queries.sql`
- local/private workbook generated by the export script into `exports/reporting-audit/`

## Local Private Export Note

The generated Excel workbook is intentionally local-only.

It may contain:

- names
- phone numbers
- email addresses

Do not commit or stage the workbook.