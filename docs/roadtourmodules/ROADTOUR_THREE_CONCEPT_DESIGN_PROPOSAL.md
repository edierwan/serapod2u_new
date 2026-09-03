# RoadTour — Shop Performance, Revisit Identity and Follow-Up Lifecycle

Design proposal, 4 Sep 2026, branch `roadtour_issues`.
Evidence read-only from production (`serapod-prd-db`, database `supabase`).
**Nothing migrated, deployed or pushed. No production writes.**

---

## 0. The finding that reshapes this proposal

You asked me to prove, independently of UI wording, whether a second AM QR scan
by the same shop in the same campaign is blocked from receiving points.

**It is not blocked. Shop-level reward protection does not exist today**, and it
fails at three independent layers.

**Layer 1 — the configured policy is per person, not per shop.**

```
        name      |        duplicate_policy
   RoadTour 2026  | one_participant_once_per_event
```

`effectiveDuplicateRule = runDuplicatePolicy || duplicate_rule_reward || 'one_per_user_per_campaign'`
(`claim-reward/route.ts:478`), so the run policy wins. That rule
(`route.ts:316-326` → `hasParticipantDuplicate`, `route.ts:298-314`) matches only
on `consumer_phone`. A different person at the same shop is not a duplicate.

**Layer 2 — the shop-scoped rules are defeated by a NULL column.** The
`per_campaign` branch (`route.ts:385-387`) filters
`roadtour_scan_events.shop_id`, and **all 199 production scan events have
`shop_id IS NULL`**, so the filter matches nothing and never blocks.

**Layer 3 — the database function has no branch for these rules.**
`record_roadtour_reward` handles only `one_per_user_per_campaign`,
`one_per_user_per_day` and `one_per_shop_per_am_per_day`; everything else falls
to `ELSE v_existing_count := 0` — no protection at all. And
`one_per_shop_per_am_per_day` compares `shop_id = p_shop_id`, which is
`NULL = NULL` → never true.

**Confirmed in production data.** Recovering the shop through
`roadtour_survey_responses.shop_id` (scan events cannot be joined on shop):

```
 campaign_id | shop_id | rewarded_scans | distinct_am_qrs | distinct_phones
 ... 8 rows, every one:        2                1                 2
```

**Eight shops were rewarded twice inside a single campaign** — 800 points
overpaid. Note `distinct_am_qrs = 1`: the same AM's QR paid twice, because the
guard is per phone. Overall, 199 rewarded scans paid 19,900 points but produced
only 184 official visits.

**This corrects my earlier classification.** I previously called
`roadtour_scan_events.shop_id IS NULL` a participant-only defect. That holds for
the 7D calculation, which is unaffected — but it is *load-bearing for reward
duplicate protection*, so it can no longer be deferred. It must be fixed in the
same migration as the uniqueness change (§5), or tightening the constraint will
create a worse failure: the visit insert blocked while points are still paid.

---

## 1. Proposed official-visit uniqueness rule

**Recommendation: `UNIQUE (campaign_id, shop_id) WHERE visit_status = 'official'`**

| Candidate | Verdict |
|---|---|
| `roadtour_run_id + shop_id` (current) | **Remove.** One run spans the whole year (21 May – 31 Dec). It blocks the revisit that Campaign B is created to represent. |
| `campaign_id + account_manager_user_id + shop_id` | **Reject.** Campaign A has six AM QRs; including the AM lets Shop ABC claim once from each — six official visits and six rewards in one campaign. Exactly the outcome you ruled out. |
| **`campaign_id + shop_id`** | **Recommended.** The campaign *is* the intervention identity. Extra AMs and extra participants inside one campaign collapse to a single visit; Campaign B creates a new visit legitimately, even under the same run. |

`uq_roadtour_official_visit (campaign_id, account_manager_user_id, shop_id, visit_date)`
must also go. It is strictly weaker — it includes AM and date — so it would
permit precisely what `campaign_id + shop_id` forbids.

**Migration safety verified:** zero existing `(campaign_id, shop_id)` duplicates
among official visits, so the constraint applies to current data with no cleanup.

One thing to confirm with operations: production campaigns are currently named
per AM (`Road Tour KL / Selangor (Fitri)`), so today campaign ≈ AM. The rule is
correct for the multi-AM campaigns you describe, and is a no-op for existing rows.

---

## 2. Proposed `roadtour_follow_ups` schema

Append-only episodes, keyed on their own id. **No unique constraint on
`(roadtour_run_id, shop_id)`** — that would collapse exactly the history you want.

```sql
CREATE TABLE public.roadtour_follow_ups (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shop_id                 uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  roadtour_run_id         uuid REFERENCES public.roadtour_runs(id) ON DELETE SET NULL,
  source_campaign_id      uuid REFERENCES public.roadtour_campaigns(id) ON DELETE SET NULL,
  source_official_visit_id uuid REFERENCES public.roadtour_official_visits(id) ON DELETE SET NULL,

  reason            text NOT NULL,   -- no_response | steep_drop | monthly_decline | no_activity | manual
  status            text NOT NULL DEFAULT 'open',      -- open | resolved | dismissed
  management_action text,            -- monitor | contact | revisit | no_action
  assigned_am_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,

  opened_at       timestamptz NOT NULL DEFAULT now(),
  opened_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolution_note text,
  revisit_campaign_id uuid REFERENCES public.roadtour_campaigns(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT roadtour_follow_ups_status_check
    CHECK (status IN ('open','resolved','dismissed')),
  CONSTRAINT roadtour_follow_ups_resolved_fields_check
    CHECK ((status = 'open') = (resolved_at IS NULL))
);

-- At most one OPEN episode per shop per run; resolved history is unlimited.
CREATE UNIQUE INDEX uq_roadtour_follow_up_open_per_run_shop
  ON public.roadtour_follow_ups (roadtour_run_id, shop_id)
  WHERE status = 'open' AND roadtour_run_id IS NOT NULL;

CREATE INDEX idx_roadtour_follow_ups_open ON public.roadtour_follow_ups (org_id, status, opened_at DESC);
CREATE INDEX idx_roadtour_follow_ups_shop ON public.roadtour_follow_ups (shop_id, opened_at DESC);
```

The partial unique index is the important detail: it stops duplicate open
episodes for one shop without touching resolved history, so a later decline
opens a genuinely new episode while every earlier one stays auditable.
`revisit_campaign_id` closes the loop — when management chooses Revisit, the
episode records which campaign was created to answer it.

---

## 3. Shop Performance — data and query design

A continuous monthly timeline, independent of visits. **Raw monthly totals, no
per-day normalisation**, exactly as specified.

```sql
WITH monthly AS (
  SELECT shop_id,
         date_trunc('month', scanned_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date AS month,
         count(*) AS scans
  FROM public.consumer_qr_scans
  WHERE shop_id IS NOT NULL
    AND is_manual_adjustment = false
    AND scanned_at >= $window_start AND scanned_at < $window_end
  GROUP BY 1, 2
)
SELECT shop_id, month, scans AS current_scans,
       lag(scans) OVER (PARTITION BY shop_id ORDER BY month) AS previous_scans
FROM monthly;
```

State, applied in this order:

| Condition | State |
|---|---|
| `previous = 0/NULL` and `current > 0` | Newly Active |
| `previous > 0` and `current = 0` | No Activity |
| `current > previous` | Improved |
| `current = previous` | Maintained |
| `current < previous` | Declined |

`lag()` returns NULL for a shop's first observed month; a shop absent from
`monthly` in a month has zero scans, so the No Activity row must be produced by
the reporting layer from the shop roster, not by the window function alone.

**Two definitional points needing your decision.**

*What counts as valid.* Production splits by `claim_lane`:

```
 claim_lane | is_manual_adjustment |  count
 consumer   | f                    |  65,581     <- shop_id IS NULL
 shop       | f                    |  48,949     <- shop_id populated
 consumer   | t                    |       1
```

**Only shop-lane scans carry a `shop_id` at all.** So "shop performance" means
shop-lane claims — 43% of all product-QR activity. The existing 7D calculation
already has this property silently; Shop Performance would inherit it. I excluded
`is_manual_adjustment` above, which the 7D path does *not* — worth aligning
deliberately rather than by accident.

*The timeline is real and it fills your July hole.* Shop-attributable scans by
Malaysia-local month:

| Month | Shop-attributable scans | Shops with activity |
|---|---|---|
| 2026-05 | 10,990 | 98 |
| 2026-06 | 12,525 | 113 |
| 2026-07 | **13,718** | **98** |
| 2026-08 | 20,429 | 210 |
| 2026-09 | 2,278 | 61 |

July has a full month of shop performance data while AM Performance is correctly
empty. This is the clearest argument for separating the three concepts.

Per your instruction, a decline produces a **presented state, not an automatic
verdict** — management chooses Monitor, Contact, Revisit or No Action, and that
choice is what creates a follow-up episode.

---

## 4. Keeping the three concepts separated

| | AM Performance | Shop Performance | Shop Follow-Up |
|---|---|---|---|
| Question | Did this intervention work? | How is this shop trending? | What needs action now? |
| Grain | visit × 7D window | shop × calendar month | follow-up episode |
| Source | `consumer_qr_scans` around a visit anchor | `consumer_qr_scans` monthly totals | `roadtour_follow_ups` |
| Time scope | strictly the selected month | continuous timeline | open episodes, as-of month |
| Carry-forward | **never** | n/a (a timeline) | by open status |

Three loaders behind three routes, no shared month filter:

- `reporting-data.ts` → `/api/roadtour/reporting/monthly` — unchanged, month-scoped.
- `shop-performance-data.ts` → `/api/roadtour/reporting/shop-performance` — new.
- `follow-up-data.ts` → `/api/roadtour/reporting/follow-up` — new, driven by episodes.

The guarantee that keeps them apart is already under test: `carry-forward never
reaches AM Performance` in `aggregate.test.ts`.

---

## 5. Migration plan — revisit identity and timezone

Ordered so the system is never in a state where points are paid without a visit.

**Step 1 — populate the shop on scan events (prerequisite, not optional).**
Set `roadtour_scan_events.shop_id` at insert in the claim-reward path, and
backfill the 199 existing rows from `roadtour_survey_responses.shop_id`. Without
this, every shop-scoped duplicate rule stays inert (§0).

**Step 2 — make reward protection shop-scoped.** Add a
`one_shop_once_per_campaign` branch to *both* `record_roadtour_reward` and the
route's rule table, keyed on `(campaign_id, shop_id)`, and set the run's
`duplicate_policy` to it. Both layers must agree; today they disagree.

**Step 3 — stop swallowing the constraint.** Replace
`EXCEPTION WHEN unique_violation THEN NULL` with an explicit duplicate result the
caller can surface, so a blocked visit is never silent again.

**Step 4 — swap the uniqueness rule.** Drop
`uq_roadtour_official_visit_per_run_shop` and `uq_roadtour_official_visit`; add
`UNIQUE (campaign_id, shop_id) WHERE visit_status = 'official'`. Zero existing
duplicates, so no data cleanup.

**Step 5 — timezone.** `record_roadtour_reward` sets
`visit_date := CURRENT_DATE`, the database server's **UTC** date. Any scan
between 00:00 and 07:59 Malaysia time is dated to the previous day, and because
`visit_date` drives monthly scope this silently moves a visit between reports.
Replace with the scan's own timestamp in the business timezone:

```sql
visit_date := (COALESCE(v_scan_time, now()) AT TIME ZONE 'Asia/Kuala_Lumpur')::date
```

**No backfill is needed:** zero existing visits have a `visit_date` that differs
from their scan's Malaysia-local date. The defect is latent because field visits
happen in business hours — it will bite the first early-morning or automated
entry.

**Step 6 — follow-up episodes.** Create the table (§2), backfill one open episode
per currently-actionable shop, then switch the queue to read episodes.

---

## 6. What happens to the campaign-start carry-forward code

Treated as interim, exactly as you framed it. It currently lives in
`reporting-data.ts` (`carryForwardOpenItems` → earliest campaign `start_date`)
and `aggregate.ts` (`selectFollowUpQueueEntries`, `isOpenFollowUp`).

Once episodes exist, the queue loads **open episodes** and joins to visit and
shop data — bounded by the number of open items rather than by all history. Then:

- delete `carryForwardOpenItems` and the campaign-start floor from the loader;
- keep `selectFollowUpQueueEntries` as the as-of-month selector, with `isOpenFollowUp`
  reading `episode.status` instead of inferring from priority;
- keep the resolution seam in `buildShopEntries` — it becomes the real path;
- retain every test in §8; only the fixture source changes.

Until then it stays, because it is the only thing keeping unresolved work visible.

---

## 7. UI and menu changes

**New page: `Shop Performance` — `/roadtour/reporting/shop-performance`**, in the
RoadTour Reporting nav between AM Performance and Shop Follow-Up (`roadtourNav.ts`,
plus a `roadtour-shop-performance` case in `DashboardContent.tsx`).

Shop rows with a monthly sparkline, previous vs current scans, delta, and a state
pill (Improved / Maintained / Declined / Newly Active / No Activity). Filters for
region, campaign and state; sortable; CSV export. Because the system presents
rather than decides, each row offers an explicit **Take action** control —
Monitor, Contact, Revisit, No Action — and choosing anything other than Monitor
opens a follow-up episode. Choosing Revisit prompts for the new campaign and
stores it as `revisit_campaign_id`.

**Shop Follow-Up** gains a Resolve / Dismiss action with reason and note, a
resolved-history toggle, the originating visit date and campaign on every row so
issue age stays visible, and an episode timeline on the shop drill-down.

**AM Performance** is unchanged, and should carry a one-line note that it measures
a single month's interventions — with a link to Shop Performance for the
continuous view. That is the honest answer to "why is July empty".

---

## 8. Regression and data-migration risks

| Risk | Severity | Mitigation |
|---|---|---|
| Steps 1–2 not shipped before step 4 | **High** | Constraint blocks the visit while points are still paid — a worse version of today. Ship 1–4 as one migration, in order. |
| Backfilling `scan_events.shop_id` from survey responses | Medium | 15 of 199 scans have no visit; verify each resolves via `roadtour_survey_responses` before writing, and leave unresolvable rows NULL rather than guessing. |
| Existing double-rewards (8 shops, 800 points) | Medium | Pre-existing. Decide explicitly whether to claw back or write off — do not let the migration silently change balances. |
| Dropping `uq_roadtour_official_visit` | Medium | It currently blocks same-AM-same-day repeats; `campaign_id + shop_id` is strictly stronger, so verify no code depends on the old name. |
| Shop Performance vs AM Performance disagreeing | Medium | They will differ legitimately (monthly totals vs a 7D window, and different manual-adjustment handling). Document it in the UI or the first support question will be "why don't these match". |
| Consumer-lane scans invisible to both reports | Medium | 57% of product-QR activity has no `shop_id`. Confirm this is intended before publishing Shop Performance as "shop activity". |
| Episode backfill duplicating open items | Low | Partial unique index on `(roadtour_run_id, shop_id) WHERE status='open'` makes a double backfill fail loudly. |
| Timezone change shifting historical months | **None measured** | Zero visits currently differ between UTC and Malaysia-local date; the fix is forward-looking. |
