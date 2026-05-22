# 22 — Post-Visit Impact Reporting (UI Implementation)

Date: 2026-05-23
Owner: Product Eng (RoadTour)

## Purpose

Add a Post-Visit Impact analytics suite to the RoadTour module so management can answer "Do shops actually improve after RoadTour staff visit them?".

## Reference Images

UI/UX targets supplied by the requester:

1. Post-Visit Impact Report — KPIs + before/after bar chart + Top Impacted Shops
2. Shop Impact Detail — Shop-level drilldown + Selected Shop Snapshot panel
3. Account Manager Impact Performance — AM leaderboard + insight cards
4. Follow-Up Priority & Opportunity Queue — Operational queue + priority rules

## Routes / View IDs Added

| View ID | Component | Purpose |
| --- | --- | --- |
| `roadtour-post-visit-impact` | `PostVisitImpactReportView` | Management overview |
| `roadtour-shop-impact` | `ShopImpactDetailView` | Shop drilldown + snapshot |
| `roadtour-am-impact` | `AccountManagerImpactPerformanceView` | AM leaderboard |
| `roadtour-follow-up-priority` | `FollowUpPriorityQueueView` | Follow-up queue |

All four are reached via **RoadTour → Analytics** in the top nav.

## Nav Refactor (Issue 1)

`roadtourNav.ts` was reorganized:

- **Field Operations** group removed (it had no remaining pages).
- **Visits** moved from Field Operations → **Analytics** group.
- **Surveys** moved from Field Operations → **Settings** group.
- Four new analytics children added under Analytics.

`DashboardContent.tsx` was updated to route the four new view IDs to the new views.

## Files Changed / Added

Added:
- `app/src/modules/roadtour/types/analytics.ts` — shared types + classification helpers
- `app/src/modules/roadtour/types/analytics.test.ts` — vitest unit tests for classification
- `app/src/modules/roadtour/lib/analytics/postVisitImpact.ts` — data loader (before/after windowing)
- `app/src/modules/roadtour/lib/analytics/useImpactDataset.ts` — shared React hook + filters state
- `app/src/modules/roadtour/components/analytics/AnalyticsFilterBar.tsx`
- `app/src/modules/roadtour/components/analytics/shared.tsx` — KPI card, pills, helpers
- `app/src/modules/roadtour/components/analytics/PostVisitImpactReportView.tsx`
- `app/src/modules/roadtour/components/analytics/ShopImpactDetailView.tsx`
- `app/src/modules/roadtour/components/analytics/AccountManagerImpactPerformanceView.tsx`
- `app/src/modules/roadtour/components/analytics/FollowUpPriorityQueueView.tsx`

Modified:
- `app/src/modules/roadtour/roadtourNav.ts` (nav refactor)
- `app/src/components/dashboard/DashboardContent.tsx` (route new views)

No SQL/migrations/schema changes made.

## Data Sources

| Table | Purpose |
| --- | --- |
| `roadtour_campaigns` | Scope campaigns to org |
| `roadtour_official_visits` | Anchor — `visit_date`, `shop_id`, `account_manager_user_id`, `campaign_id`, `notes` |
| `consumer_qr_scans` | Shop scan activity (`shop_id`, `scanned_at`) for before/after counts |
| `organizations` | Shop name, org_code, city, state via `states:state_id(state_name)` |
| `users` | Account manager name |

`consumer_qr_scans` was chosen (over `roadtour_scan_events`) because the business question is "Did consumer/product scan activity at the shop improve?" which is broader than scans tied solely to RoadTour QR codes.

## Window Logic

For each official visit `v` and window `W ∈ {3, 7, 30}` days:

- `before_window  = (v.visit_date − W days, v.visit_date)`
- `after_window   = (v.visit_date, v.visit_date + W days)`
- Scans on the visit day itself are counted as "after" (post-anchor intent).

The loader fetches `consumer_qr_scans` for all visited shops once over the widest required range (`minVisit − W` … `maxVisit + W`) then buckets per-visit in memory.

## Metrics

```
scan_lift              = after - before
scan_lift_percent      = before > 0 ? ((after - before) / before) * 100 : null
avg_scan_lift_percent  = mean(scan_lift_percent) over shops where before > 0
median_scan_lift_percent = median(...)
visit_to_scan_conversion = shops with after > 0 / visited shops
```

Shop-level aggregation collapses multiple visits to the latest visit per shop for summary metrics.

## Status Classification

| Status | Rule |
| --- | --- |
| Newly Activated | `before == 0 && after > 0` |
| Improved | `before > 0 && after > before` |
| Maintained | `before > 0 && after == before` |
| Dropped | `before > 0 && after < before` |
| No Response | `after == 0` |

## Follow-Up Priority Rules

| Priority | Trigger |
| --- | --- |
| High | `after == 0 && days_since_visit >= 7` OR drop > 50% vs before |
| Medium | `after == 0 && 3 ≤ days_since_visit < 7` OR newly activated OR dropped OR maintained with `after ≤ 1` |
| Healthy | improved with `after/before − 1 ≥ 50%` |
| Low | everything else (typically improved/maintained with positive activity) |

Recommended action + next follow-up date are derived from these rules.

## Known Data Limitations

- The reports rely on `consumer_qr_scans.shop_id` being populated. Scans without `shop_id` are silently skipped. Track via the staging banner shown when scan data load fails.
- `roadtour_official_visits.visit_date` is a date (no time). Same-day scans are bucketed into the after-window.
- No region table beyond `states` is currently used; region filter uses `organizations.state_id`.
- Shop "code" is `organizations.org_code`.

## Optional Future Enhancements (Not Implemented)

- **Reporting view** `vw_roadtour_post_visit_impact` for fast server-side aggregation if visit volume crosses ~10k/month.
- Persisted follow-up tasks table (`roadtour_follow_up_tasks`) so the "Create Follow-Up Task" button can write state. Currently the button is rendered but disabled with `Coming soon`.
- Region picker by district or custom region grouping.

Schema changes are **not** included in this task per the explicit constraint.

## Staging Validation Checklist

1. Sign in as HQ Admin.
2. Open `RoadTour → Analytics → Analytics Overview` — existing page still works.
3. Confirm new menu items appear:
   - Visits
   - Post-Visit Impact Report
   - Shop Impact Detail
   - Account Manager Impact
   - Follow-Up Priority Queue
   - WhatsApp Monitoring
4. Confirm **Field Operations** group is gone and **Surveys** is now under **Settings**.
5. Open Post-Visit Impact Report:
   - KPI cards render or show 0 if no visits
   - 3D / 7D / 30D toggle re-runs query and updates the bar chart
   - Top Impacted Shops table renders
6. Open Shop Impact Detail:
   - Status filter works
   - Click a row → Selected Shop Snapshot updates (status pill, before/after bars, mini trend chart, notes)
   - "Create Follow-Up Task" is disabled with `Coming soon`
7. Open Account Manager Impact Performance:
   - Leaderboard ranks by Avg Lift %
   - Scatter shows Visit Count vs Conversion %
8. Open Follow-Up Priority Queue:
   - Priority pills classify per rules above
   - CSV export downloads
   - Filter by Priority / Days Since Visit narrows the table
9. Confirm Campaigns, QR Management, Visits, Surveys (now under Settings), RoadTour Settings, WhatsApp Monitoring still work unchanged.

## Tests

`app/src/modules/roadtour/types/analytics.test.ts` covers:

- `classifyImpactStatus` for all 5 statuses
- `computeScanLiftPercent` for zero/positive before
- `classifyFollowUpPriority` for high/medium/healthy/low
- `recommendedAction` cases
- `recommendedFollowUpDate` shape

Run with `pnpm vitest run src/modules/roadtour/types/analytics.test.ts` (or `npm test`).
