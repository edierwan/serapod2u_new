# RoadTour — Pre-migration audits and final implementation plan

4 Sep 2026, branch `roadtour_issues`. Read-only evidence from production
(`serapod-prd-db`, database `supabase`). **No migration applied, nothing pushed,
no production data changed.**

---

## 1. Manual-adjustment impact audit — clean, zero impact

Replicating the 7D windows for **all 184 official visits**, counting
`consumer_qr_scans` with and without `is_manual_adjustment = true`:

```
 visits_audited | before_changes | after_changes | responded_flips
            184 |              0 |             0 |               0
```

| Requested measure | Result |
|---|---|
| Visits whose `before_scans` changes | **0** |
| Visits whose `after_scans` changes | **0** |
| Visits whose outcome classification changes | **0** |
| AM response-rate results affected | **0** |

**Why it is zero.** The entire table contains exactly one manual adjustment:

```
 is_manual_adjustment | has_shop | count  |   first    |    last
 f                    | f        | 137854 | 2025-12-22 | 2026-09-03
 f                    | t        |  65157 | 2025-12-30 | 2026-09-03
 t                    | f        |      1 | 2026-06-19 | 2026-06-19   <- adjustment_type = manual_add
```

That single row has `shop_id IS NULL`, and the 7D loader selects only
`.in('shop_id', chunk)`. It has therefore never been counted by any RoadTour
report. The exclusion is already true in practice.

**Recommendation: align AM Performance to the same non-manual definition.**
It is a zero-risk change today — no historical number moves — and it removes a
real future divergence: the moment someone records a manual adjustment against a
shop, AM Performance would start counting it as post-visit response while Shop
Performance would not. Align now, while the audit proves the change is inert.

---

## 2. `collected_points = false` semantics — a page view, not a claim

Traced through the two writers of `consumer_qr_scans`:

- **`api/consumer/track-scan/route.ts:86-108`** creates a row on journey
  interaction. It sets `viewed_welcome: true` and only sets
  `collected_points = true` when `action === 'collect_points'`. It never sets
  `shop_id`, and `claim_lane` falls to its `'consumer'` default.
- **`api/consumer/collect-points/route.ts:713-749`** is the real claim path. It
  sets `shop_id: shopUser.organization_id` and `claim_lane` on the row.

So **`collected_points = false` means the QR journey page was opened but no
points claim was completed** — an engagement event, not a transaction.

Production confirms the two are perfectly correlated with shop attribution:

```
 collected_points | claim_lane | has_shop |  count
 f                | consumer   | f        | 118487
 t                | shop       | t        |  64595
 t                | consumer   | f        |  19368
 t                | consumer   | t        |    562
```

**Every shop-attributable row already has `collected_points = true`; no
shop-attributed row has it false** (64,595 + 562 = 65,157, the exact
`has_shop = t` total).

**Recommendation: do not add the filter.** `shop_id IS NOT NULL` already implies
it, so adding it is a strict no-op that only makes the query harder to read.

**One honest limitation to record.** Because shop attribution exists *only* on
completed claims, Shop Performance necessarily measures **completed point claims
at a shop**, not raw product-QR scan attempts. That is narrower than "product QR
scan activity" as stated in the brief. There is no way to widen it without
inventing attribution for the 118,487 attempt-only rows, which decision 4
explicitly forbids. The metric is internally consistent and comparable
month-to-month; the label in the UI should say what it counts.

---

## 3. Final ordered migration plan

Sequenced so shop-level reward protection is real **before** the visit constraint
tightens, per decision 2. Steps 1–4 must ship as one deployment.

**Step 1 — reliable shop attribution on scan events.**
Set `roadtour_scan_events.shop_id` at insert in the claim-reward path. Backfill
the 199 existing rows from `roadtour_survey_responses.shop_id`; leave any row
that cannot be resolved NULL rather than guessing. Verify with
`count(*) FILTER (WHERE shop_id IS NULL)` before and after.

**Step 2 — enforce one shop, one campaign reward.**
Add a `one_shop_once_per_campaign` rule keyed on `(campaign_id, shop_id)` to
**both** enforcement points, which currently disagree:
- `record_roadtour_reward` — a new branch, so it no longer falls to
  `ELSE v_existing_count := 0`;
- `claim-reward/route.ts` — the rule table alongside `per_campaign`.
Then set `roadtour_runs.duplicate_policy = 'one_shop_once_per_campaign'`.

**Step 3 — surface blocked visits instead of swallowing them.**
Replace `EXCEPTION WHEN unique_violation THEN NULL` in `record_roadtour_reward`
with an explicit duplicate result the caller can return, so a blocked visit is
never silent again.

**Step 4 — replace the uniqueness rule.**
```sql
DROP INDEX IF EXISTS uq_roadtour_official_visit_per_run_shop;
ALTER TABLE public.roadtour_official_visits DROP CONSTRAINT IF EXISTS uq_roadtour_official_visit;
CREATE UNIQUE INDEX uq_roadtour_official_visit_per_campaign_shop
  ON public.roadtour_official_visits (campaign_id, shop_id)
  WHERE visit_status = 'official';
```
Verified safe: **zero existing `(campaign_id, shop_id)` duplicates.**

**Step 5 — timezone correction.**
`record_roadtour_reward` currently sets `visit_date := CURRENT_DATE`, the
server's UTC date. Replace with the scan's own instant in the business timezone:
```sql
visit_date := (COALESCE(v_scan_time, now()) AT TIME ZONE 'Asia/Kuala_Lumpur')::date
```
**No backfill required:** zero existing visits differ between their UTC date and
their scan's Malaysia-local date. The defect is latent — it fires on the first
scan between 00:00 and 07:59 MYT.

**Step 6 — follow-up episodes.**
Create `roadtour_follow_ups` as approved, with the partial unique index on
`(roadtour_run_id, shop_id) WHERE status = 'open'` and `revisit_campaign_id`
retained. Backfill one open episode per currently-actionable shop.

**Step 7 — Shop Performance.**
New loader, route and page. Read-only; no schema change.

**Step 8 — retire the interim carry-forward.**
Once the queue reads open episodes, remove `carryForwardOpenItems` and the
campaign-start floor. Not before.

### Legacy anomaly register (documented, not corrected)

Per decision 3 — no claw-back, no balance changes, forward-fix only:

| Campaign | Shop | Code | Scans | Paid | Excess |
|---|---|---|---|---|---|
| Road Tour 2026 Jow | Street Boyz Vape Shope | SH423 | 2 | 200 | 100 |
| Road Tour 2026 Tajiy | Ab Store Vape | SH020 | 2 | 200 | 100 |
| Road Tour 2026 Tajiy | Sd Vape & Nanostix | SH408 | 2 | 200 | 100 |
| Road Tour Kl / Selangor ( Tajiy ) | Mr Vapor | SH306 | 2 | 200 | 100 |
| Road Tour Kl / Selangor (Jow) | The Vape69 (Sri Rampai) | SH545348650 | 2 | 200 | 100 |
| Road Tour Kl / Selangor (Safwan) | Konker | SH303608962 | 2 | 200 | 100 |
| Road Tour Kl / Selangor (Safwan) | Meru Vape Store (Hq) | SH282 | 2 | 200 | 100 |
| Road Tour Kl / Selangor (Safwan) | Meru Vape Store Bandar Hill Park | SH283 | 2 | 200 | 100 |

**Total excess: 800 points across 8 shops and 6 campaigns.**
**Root cause:** the run policy `one_participant_once_per_event` keys on
`consumer_phone`, so a second person at the same shop was never a duplicate; the
shop-scoped rules that would have caught it filter
`roadtour_scan_events.shop_id`, which is NULL on all 199 rows; and
`record_roadtour_reward` has no branch for those rules and falls through with no
check. Every affected row shows `distinct_am_qrs = 1` — the same AM's QR paid
twice. Flagged for management review.

---

## 4. Files and components to change

**Database (new migration, not yet written)**
- `supabase/migrations/<ts>_roadtour_intervention_identity.sql` — steps 1–5
- `supabase/migrations/<ts>_roadtour_follow_up_episodes.sql` — step 6

**Reward path**
- `app/src/app/api/roadtour/claim-reward/route.ts` — populate `shop_id` on the
  scan event; add `one_shop_once_per_campaign`; handle the explicit duplicate
  result from step 3
- `record_roadtour_reward` (DB function) — new duplicate branch, no swallow,
  timezone-correct `visit_date`

**Follow-Up**
- `app/src/lib/roadtour/follow-up-data.ts` *(new)* — loads open episodes
- `app/src/app/api/roadtour/reporting/follow-up/route.ts` *(new)*
- `app/src/app/api/roadtour/follow-ups/[id]/resolve/route.ts` *(new)*
- `app/src/modules/roadtour/lib/reporting/aggregate.ts` — `isOpenFollowUp` reads
  `episode.status`; the resolution seam becomes the real path
- `app/src/modules/roadtour/components/reporting/ShopFollowUpView.tsx` — Resolve
  / Dismiss, resolved-history toggle, originating visit date and campaign

**Shop Performance**
- `app/src/lib/roadtour/shop-performance-data.ts` *(new)*
- `app/src/app/api/roadtour/reporting/shop-performance/route.ts` *(new)*
- `app/src/modules/roadtour/lib/reporting/shopPerformance.ts` *(new)* — the five
  states, pure and unit-testable
- `app/src/modules/roadtour/components/reporting/ShopPerformanceView.tsx` *(new)*
- `app/src/app/roadtour/reporting/shop-performance/page.tsx` *(new)*
- `app/src/modules/roadtour/roadtourNav.ts` and
  `app/src/components/dashboard/DashboardContent.tsx` — nav entry and view case

**AM Performance**
- `app/src/lib/roadtour/reporting-data.ts` — add
  `is_manual_adjustment = false` to the `consumer_qr_scans` fetch (§1); remove
  `carryForwardOpenItems` at step 8

**UI wording**
- Wherever the duplicate policy is labelled, replace "one participant once per
  event" with **"One Shop Once Per Campaign"** (decision 2).

---

## 5. Rollback plan

Each step is independently reversible; steps 1–4 roll back as a unit.

| Step | Rollback |
|---|---|
| 1 · scan `shop_id` | Additive column write. Revert code; data is harmless if left. |
| 2 · reward rule | Reset `roadtour_runs.duplicate_policy` to its current value and redeploy the prior function. Record the current value before changing it. |
| 3 · no swallow | Restore the prior function body. |
| 4 · uniqueness | Drop the new index, recreate the two originals. Reversible **only while no shop has two official visits in one run** — after the first legitimate revisit the old constraint can no longer be recreated without deleting a real visit. **This is the point of no return.** |
| 5 · timezone | Restore `CURRENT_DATE`. Any rows written in between keep their corrected date; no backfill either way. |
| 6 · episodes | `DROP TABLE roadtour_follow_ups`. Purely additive until the queue switches to it. |
| 7 · Shop Performance | Read-only feature; remove the route and nav entry. |
| 8 · carry-forward removal | Git revert. Do not run before step 6 is stable in production. |

All function changes deploy as `CREATE OR REPLACE FUNCTION`, so capture the
current definitions with `pg_get_functiondef` into the migration's `down` script
before applying.

---

## 6. Expected tests

**Existing — must stay green:** 111 tests, including the required cases A–F and
the guarantee that carry-forward never reaches AM Performance.

**Reward protection (new)**
- Second scan by a *different phone* at the same shop in the same campaign is
  rejected as duplicate and awards zero points — the case that produced the 8
  legacy anomalies.
- Second scan by a different *AM QR* in the same campaign is likewise rejected.
- The same shop in a *new* campaign is accepted and creates a new official visit.
- A blocked visit returns an explicit duplicate result rather than success.

**Uniqueness (new)**
- Two official visits, same campaign and shop → constraint violation.
- Same shop, different campaigns, same run → both rows persist.
- `visit_status = 'manual'` is unaffected by the partial index.

**Timezone (new)**
- A scan at 02:00 MYT (18:00 UTC previous day) records `visit_date` as the
  Malaysia date, and lands in the correct reporting month.
- A scan at 23:00 MYT records the same Malaysia date.

**Shop Performance (new)**
- All five states: Improved, Maintained, Declined, Newly Active, No Activity.
- A shop absent from a month yields No Activity, not a missing row.
- No per-day normalisation — a 28-day and a 31-day month with equal totals are
  Maintained.
- `is_manual_adjustment = true` rows are excluded.
- Shops with `shop_id IS NULL` scans never appear.

**Follow-Up episodes (new)**
- Resolving an episode removes the shop from later active queues; the episode
  stays readable for audit.
- A later decline opens a *new* episode while the resolved one persists.
- The partial unique index rejects a second open episode for the same shop/run.
- `revisit_campaign_id` links episode → campaign → new visit → new 7D observation.

**Regression audit to re-run after migration**
- Re-run the §1 audit: all 184 historical visits must report identical
  before/after counts and outcomes.
- June AM Performance must still read 31 shops / 51.6% / 5 active AMs.
