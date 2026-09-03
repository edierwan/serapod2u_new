# RoadTour Reporting — July gap and cross-month monitoring

Investigated 2026-09-04 on branch `roadtour_issues`.
Evidence gathered read-only against **production** (`serapod-prd-db`, database
`supabase`, VPS `187.127.215.40`). No production writes were made.

> Note on environments: `app/.env.local` points at
> `supabase-stg-serapod.getouch.cloud`, which holds **1** RoadTour official visit
> in total. The June/July/August numbers in the brief are production numbers, so
> all evidence below comes from the production database.

---

## 1. The exact query logic behind both reports

Both reports — and Monthly Overview and the shop drill-down — are fed by **one
loader and one API route**. There is no separate `am-performance` or `follow-up`
query.

- API route: [`app/src/app/api/roadtour/reporting/monthly/route.ts`](../../app/src/app/api/roadtour/reporting/monthly/route.ts)
- Loader: [`app/src/lib/roadtour/reporting-data.ts`](../../app/src/lib/roadtour/reporting-data.ts)
- Client hook: `app/src/modules/roadtour/lib/reporting/useMonthlyReporting.ts`
- Views: `AmPerformanceView.tsx`, `ShopFollowUpView.tsx`

The month scoping, verbatim, at `reporting-data.ts:126-134` **before this fix**:

```ts
    // ── Official visits inside the selected calendar month ──────────────────
    let visitQuery = params.admin
        .from('roadtour_official_visits')
        .select('id, campaign_id, account_manager_user_id, shop_id, visit_date, visit_status, notes, official_scan_event_id, created_at')
        .in('campaign_id', campaignIds)
        .in('visit_status', REPORTABLE_VISIT_STATUSES)
        .gte('visit_date', month.startDate)
        .lte('visit_date', month.endDate)
```

and the early return at `reporting-data.ts:141-144`:

```ts
    const visits = (visitRows || []) as VisitRecord[]
    if (visits.length === 0) {
        return emptyDataset(month.key, windowDays, now, null)
    }
```

Both reports then derive everything from `dataset.rows` via
`buildShopEntries()` in
[`aggregate.ts`](../../app/src/modules/roadtour/lib/reporting/aggregate.ts).
`ShopFollowUpView.tsx:64` (before the fix):

```ts
    const entries = useMemo(() => (dataset ? buildShopEntries(dataset.rows) : []), [dataset])
```

**Consequence:** zero visits dated inside the selected month ⇒ zero rows ⇒ both
reports render their empty state. Follow-up status is never consulted.

---

## 2. Root cause of the July gap — operational, not a bug

July 2026 had **no field activity at all**, and the promotion path is healthy.

```
 month      | visit_status | count          month      | scans | shops
------------+--------------+-------        ------------+-------+-------
 2026-05-01 | official     |    26          2026-05-01 |    30 |     0
 2026-06-01 | official     |    31          2026-06-01 |    35 |     0
 2026-08-01 | official     |   127          2026-08-01 |   134 |     0
```

July is absent from **both** `roadtour_official_visits` and
`roadtour_scan_events`. Of 199 scan events ever recorded, **0** fall in July.

Scans slightly exceed official visits every month (30/26, 35/31, 134/127), which
is what a working scan → official-visit promotion looks like. **Nothing failed to
promote.** `record_roadtour_reward` / `ellbow_award_roadtour_scan` are not implicated.

Meanwhile `consumer_qr_scans` was busy all July (31,751 scans), so the shops were
trading — only the AM visits stopped.

### Both prime suspects are ruled out

**Runs and campaigns were active through July**, so this was not a coverage gap:

| | start | end | status |
|---|---|---|---|
| Run `RoadTour 2026` | 2026-05-21 | 2026-12-31 | active |
| 6 campaigns (Bulat, Tajiy, Safwan, Jow, Bob, Aravin) | 2026-05-21 / 06-15 | 2026-12-31 | active |
| 7 campaigns (KL/Selangor) | 2026-08-05 | 2026-09-30 | active |

QR codes were live all July. AMs simply did not visit shops.

**The KPI-cycle gate hypothesis is dead**, twice over:

```
 kpi_month  | status | period_start | period_end | activated_at
------------+--------+--------------+------------+--------------
 2026-07-01 | draft  | 2026-07-01   | 2026-07-31 |
(1 row)
```

Only one cycle row exists in the whole table — July, `draft`, never activated.
June and August have **no cycle row at all** and report perfectly well. And
`roadtour_kpi_cycles` is never read by the reporting path: it appears only under
`app/src/app/api/roadtour/kpi/**` and `app/src/lib/roadtour/kpi-report.ts`, never
in `reporting-data.ts`. Cycles do not gate reporting.

**Conclusion (A): a real operational gap.** No code fix applies. If July should
show something, that is a data-entry question, not an engineering one.

---

## 3. Root cause of shops not staying visible across months — a real bug

Confirmed as suspected in the brief, and it reproduces **today** far more sharply
than July does.

Production has **0 official visits dated on or after 2026-09-01**. So on
2026-09-04 the September Follow-Up queue is empty — while August's 127 shops
include 28 high-priority ones that were never revisited. Nothing was resolved;
the calendar simply rolled over.

The mechanism is the `visit_date` BETWEEN filter quoted in §1. A follow-up item
is attributed only to the month of its originating visit, and
`uq_roadtour_official_visit_per_run_shop` allows just one official visit per shop
per run — so once that single visit's month passes, **no row exists that can put
the shop back in any later month's queue.**

`attribution.ts` states the design outright: *"Attribution rules for shops visited
more than once inside the selected month."*

### There is no resolution tracking

`\d public.roadtour_official_visits` confirms the brief's open question:

```
 id | campaign_id | account_manager_user_id | shop_id | official_scan_event_id
 official_survey_response_id | visit_date | visit_status | notes | created_at
 updated_at | roadtour_run_id
```

There is **no `resolved_at`, no `follow_up_status`, no `follow_up_due_date`**.
Priority and due date are derived at read time in `followUp.ts` from the
before/after scan counts. So "unresolved" can only be inferred, and an item can
only leave the queue by the shop being revisited or its scans recovering.

---

## 4. The fix

Commit `903400ee`. No schema change and no migration — the fix is a scoping
change, so it deploys on its own.

The queue tracks outstanding work, not one month's visits:

1. `loadRoadtourReportingDataset` takes `carryForwardMonths`. The selected month
   still bounds the **end** of the report (viewing August never shows a September
   visit); only the start moves back. The consumer-scan window follows the same
   start so carried-forward rows keep real before/after counts.
2. `selectFollowUpQueueEntries()` (aggregate.ts) keeps a shop visited **during**
   the month whatever its priority — that is the month's own work — and carries an
   **earlier** shop forward only while its follow-up is still open.
3. Open = `high` | `medium` | `observing`. `observing` is included so a shop
   visited on 30 August stays visible through 6 September, the week that actually
   decides its outcome. `healthy` and `low` do not carry forward, so the queue
   does not accumulate every shop ever visited.
4. `ShopFollowUpView` passes `FOLLOW_UP_CARRY_FORWARD_MONTHS = 6` and labels how
   many rows are carried: *"N still open from an earlier month."*
5. **Monthly Overview, AM Performance and the shop drill-down are untouched** —
   they pass no option and keep strict single-month scope. AM Performance measures
   a period's work and must stay that way, as the brief anticipated.

### Recommendations not implemented (deliberately out of scope)

- **Add resolution tracking.** `follow_up_resolved_at timestamptz`,
  `follow_up_resolved_by uuid`, `follow_up_resolution_note text` on
  `roadtour_official_visits`, plus a "Mark resolved" action, would let
  `isOpenFollowUp()` test a real fact instead of inferring from scan counts. Until
  then a shop that never responds and is never revisited stays high-priority
  indefinitely — arguably correct, but it cannot be acknowledged and closed.
- **KPI cycles do not need auto-creation for reporting's sake.** They gate nothing
  here. Auto-creating them may still be worth doing for the KPI module itself,
  which is a separate question.
- **Separate bug worth its own ticket:** all 199 rows in `roadtour_scan_events`
  have `shop_id IS NULL`. `reporting-data.ts` skips null-shop scans when building
  `scanEventsByShop`, so that map is always empty and visit participants resolve
  only from the single `official_scan_event_id`. `participant_count` is therefore
  effectively capped at 1. This does not affect the month-scoping fix.

---

## 5. Test plan

Automated: 5 new cases in `aggregate.test.ts` cover an August no-response shop
carried into September, an August shop still observing, a healthy August shop
correctly dropped, September's own visits, and the KPI summary. Full RoadTour
reporting suite: **107 passed**. `tsc --noEmit`: no errors in any changed file.

Manual, against production data after deploy:

1. **`/roadtour/reporting/follow-up?month=2026-09`** — the regression that matters.
   Before: "Nothing in this queue". After: **101 shops — 56 high, 45 medium**
   (verified by replicating the priority rules in SQL against production). The
   header should read *"N still open from an earlier month."*
2. **`?month=2026-08`** — must be unchanged: 127 shops, 28 high priority, 63
   overdue. August's own visits dominate; only pre-August open items are added.
3. **`/roadtour/reporting/am-performance?month=2026-06`** — must be **unchanged**:
   31 shops, 51.6% 7D response, 5 active AMs. This proves carry-forward did not
   leak into the month-scoped reports.
4. **`am-performance?month=2026-09`** — still "No account manager activity". Correct:
   no AM did any work in September, and performance is a period measure.
5. **`?month=2026-07`** — Follow-Up now shows June's unresolved shops instead of an
   empty queue. AM Performance stays empty, which is the honest answer for a month
   with no visits.
6. Spot-check one carried-forward shop: its Last Visit date is in August, its
   Follow-Up Due date is in the past, and it is flagged overdue.
