# RoadTour Module — Complete Documentation

## 📋 Overview

**RoadTour** is an integrated system for managing field visits and KPI (Key Performance Indicators) for Account Managers (AMs). It enables organizations to track AM visits to shops, measure performance, and calculate incentives.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                    API Layer                         │
│  /api/roadtour/events          │  /api/roadtour/kpi/  │
│  /api/roadtour/products        │  /api/roadtour/kpi/  │
│  /api/roadtour/scan-issues     │    cycles/            │
│  /api/roadtour/settings-status │    plans/             │
│  /api/roadtour/claim-reward    │    teams/             │
│  /api/roadtour/events/[id]     │    rules/             │
│                    │  report/            │
│                    │  incentive-export/  │
├─────────────────────────────────────────────────────┤
│                 Business Logic                       │
│  lib/roadtour/                                       │
│    kpi.ts              - Core KPI calculation fns    │
│    kpi-report.ts       - Monthly KPI report builder  │
│    duplicate-protection.ts - Scan deduplication      │
│    geolocation.ts      - Geo-location validation     │
│    milestone.ts        - Reward milestone management │
│    notifications.ts    - WhatsApp notification sender│
│    server.ts           - QR validation & routing     │
│    events.ts           - Event management            │
│    survey.ts           - Shop surveys                │
│    campaign-text.ts    - Campaign text formatting    │
│    visit-region.ts     - Visit region analysis       │
│    url.ts              - URL builder                 │
├─────────────────────────────────────────────────────┤
│              UI Components                           │
│  modules/roadtour/components/                        │
│    RoadtourCampaignsView       - Campaign Mgmt       │
│    RoadtourAnalyticsView       - Analytics           │
│    RoadtourKpiSettingsView     - KPI Settings        │
│    RoadtourVisitsView          - Visit Log           │
│    RoadtourScanPage            - Scan Page           │
│    RoadtourQrManagementView    - QR Management       │
│    ... (15+ Components)                              │
└─────────────────────────────────────────────────────┘
```

---

## 🎯 KPI Core Components

### 1. Teams

- **Team**: A group of Account Managers (AMs) under a Team Leader
- **Monthly Team Target**: Team's monthly scan target
- **Incentive Budget**: Maximum incentive per AM (cap)

### 2. Account Managers (AMs)

- Each AM has an **individual target** (auto-distributed from the team target)
- Targets can be manually overridden (`manual_target_scans`)
- Achievement is calculated as `actual_scans / assigned_target`

### 3. Incentive Rules

| Type            | Applies To    | Description                                      |
| --------------- | ------------- | ------------------------------------------------ |
| `all_ams`       | All AMs       | Achievement threshold triggers payout            |
| `team_leader`   | Team Leader   | Extra bonus for leader when team achieves target |
| `specific_team` | Specific Team | Rule scoped to a particular team                 |

### 4. Performance Status

| Status        | Threshold | Meaning               |
| ------------- | --------- | --------------------- |
| `achieved`    | ≥ 100%    | Target met 🎉         |
| `on_track`    | ≥ 85%     | On the right track 👍 |
| `at_risk`     | ≥ 70%     | At risk ⚠️            |
| `needs_focus` | < 70%     | Needs focus 🔴        |

### 5. Volume Tier System

| Scan Volume     | RM/scan |
| --------------- | ------- |
| 0 - 10,000      | 0.00    |
| 10,001 - 20,000 | 0.10    |
| 20,001 - 30,000 | 0.12    |
| 30,001 - 40,000 | 0.15    |
| 40,001+         | 0.20    |

---

## 🔄 Workflow

### Monthly KPI Cycle

```
1. Create KPI Plan (once per event)
   └─ Defines the Event and time range

2. Create Teams and Members
   └─ Auto-distribute targets

3. Configure Incentive Rules (optional)

4. Activate the Cycle
   └─ Freeze targets (freeze_members_targets = true)

5. Field Scanning (throughout the month)
   └─ AMs scan QR codes at shops

6. Compute End-of-Month Report
   └─ computeKpiReport()
   └─ Displayed in MonthlyKpiPerformanceReportView

7. Export Incentives to Accounting (optional)
   └─ POST /api/roadtour/kpi/incentive-export
```

### Scan & Visit Recording

```
1. AM scans the shop's QR Code
2. System validates:
   ├─ QR validity (validate_roadtour_qr_token)
   ├─ Duplicate check (duplicate-policy)
   ├─ Geolocation (optional)
   └─ Event validity (start/end dates)
3. Scan event is recorded (scan_event)
4. Points are awarded (if loyalty program)
5. WhatsApp notification is sent (optional)
```

---

## 🗄️ Database Tables

### KPI Tables

| Table                          | Description               |
| ------------------------------ | ------------------------- |
| `roadtour_kpi_plans`           | KPI plans (one per event) |
| `roadtour_kpi_cycles`          | Monthly KPI cycles        |
| `roadtour_kpi_teams`           | Teams                     |
| `roadtour_kpi_team_members`    | AMs in teams              |
| `roadtour_kpi_incentive_rules` | Incentive rules           |

### Core RoadTour Tables

| Table                              | Description               |
| ---------------------------------- | ------------------------- |
| `roadtour_runs`                    | Events / Tours            |
| `roadtour_campaigns`               | Campaigns within an event |
| `roadtour_qr_codes`                | QR codes per campaign     |
| `roadtour_scan_events`             | Scan events               |
| `roadtour_settings`                | Notification settings     |
| `roadtour_claim_notification_logs` | Notification logs         |
| `roadtour_participant_missions`    | Reward missions           |

### Related Migrations

```
supabase/migrations/
  20260408_roadtour.sql              - Core schema
  20260409_roadtour_fixes.sql        - Fixes
  20260410_roadtour_scan_premium_flow.sql - Premium scan flow
  20260510_roadtour_hardening_and_org_rls.sql
  20260523_roadtour_duplicate_policy_participant_support.sql
  20260524_roadtour_product_qr_milestone_reward.sql
  20260621_roadtour_event_product_category_experience.sql
  20260707_roadtour_monthly_kpi.sql  - Monthly KPI
  20260707_roadtour_kpi_plan_refinement.sql
  20260708_roadtour_kpi_incentive_cap.sql
  20260709_roadtour_kpi_am_incentive_mode.sql
```

---

## 📡 API Endpoints

### Events

| Method | Path                             | Description       |
| ------ | -------------------------------- | ----------------- |
| GET    | `/api/roadtour/events`           | List events       |
| POST   | `/api/roadtour/events`           | Create new event  |
| GET    | `/api/roadtour/events/[eventId]` | Get event details |
| PATCH  | `/api/roadtour/events/[eventId]` | Update event      |

### KPI Cycles

| Method | Path                                     | Description                |
| ------ | ---------------------------------------- | -------------------------- |
| GET    | `/api/roadtour/kpi/cycles`               | List KPI cycles            |
| POST   | `/api/roadtour/kpi/cycles`               | Create new cycle           |
| GET    | `/api/roadtour/kpi/cycles/[id]`          | Get cycle details          |
| PATCH  | `/api/roadtour/kpi/cycles/[id]`          | Update cycle               |
| DELETE | `/api/roadtour/kpi/cycles/[id]`          | Delete cycle (drafts only) |
| POST   | `/api/roadtour/kpi/cycles/[id]/activate` | Activate cycle             |

### KPI Plans

| Method | Path                                    | Description      |
| ------ | --------------------------------------- | ---------------- |
| GET    | `/api/roadtour/kpi/plans`               | List plans       |
| POST   | `/api/roadtour/kpi/plans`               | Create new plan  |
| GET    | `/api/roadtour/kpi/plans/[id]`          | Get plan details |
| PATCH  | `/api/roadtour/kpi/plans/[id]`          | Update plan      |
| POST   | `/api/roadtour/kpi/plans/[id]/activate` | Activate plan    |

### KPI Teams & Rules

| Method | Path                           | Description          |
| ------ | ------------------------------ | -------------------- |
| POST   | `/api/roadtour/kpi/teams`      | Create team          |
| GET    | `/api/roadtour/kpi/teams/[id]` | Get team details     |
| PATCH  | `/api/roadtour/kpi/teams/[id]` | Update team          |
| GET    | `/api/roadtour/kpi/rules`      | List incentive rules |
| POST   | `/api/roadtour/kpi/rules`      | Create rule          |
| PATCH  | `/api/roadtour/kpi/rules/[id]` | Update rule          |

### Reports

| Method | Path                                 | Description                     |
| ------ | ------------------------------------ | ------------------------------- |
| GET    | `/api/roadtour/kpi/report`           | Monthly KPI report (JSON)       |
| GET    | `/api/roadtour/kpi/report/excel`     | Monthly KPI report (Excel)      |
| POST   | `/api/roadtour/kpi/incentive-export` | Export incentives to accounting |

### Other

| Method | Path                             | Description             |
| ------ | -------------------------------- | ----------------------- |
| GET    | `/api/roadtour/products`         | List products for event |
| POST   | `/api/roadtour/claim-reward`     | Claim reward            |
| GET    | `/api/roadtour/qr-image/[token]` | QR image                |
| POST   | `/api/roadtour/send-qr-whatsapp` | Send QR via WhatsApp    |
| GET    | `/api/roadtour/settings-status`  | Settings status         |
| GET    | `/api/scan-issues`               | Scan issues             |

---

## 🧪 Tests

### Unit Tests

| File                                                    | Tests                         | Count |
| ------------------------------------------------------- | ----------------------------- | ----- |
| `lib/roadtour/kpi.test.ts`                              | All KPI calculation functions | 36+   |
| `lib/roadtour/kpi-report.test.ts`                       | computeKpiReport              | 7     |
| `lib/roadtour/duplicate-protection.test.ts`             | Duplicate protection          | 4     |
| `lib/roadtour/milestone.test.ts`                        | Milestones & rewards          | 5     |
| `lib/roadtour/visit-region.test.ts`                     | Region analysis               | 10    |
| `lib/roadtour/campaign-text.test.ts`                    | Text formatting               | 8     |
| `modules/roadtour/CreateRoadtourEventDialog.test.tsx`   | Event creation                | -     |
| `modules/roadtour/RoadtourSettingsView.test.tsx`        | RoadTour settings             | -     |
| `modules/roadtour/components/analytics/shared.test.tsx` | Shared analytics              | -     |

---

## 🚀 Quick Start Guide

### Create a New Event

```bash
POST /api/roadtour/events
{
  "org_id": "org-123",
  "name": "RoadTour Q3 2026",
  "start_date": "2026-07-01",
  "end_date": "2026-09-30",
  "duplicate_policy": "one_participant_once_per_event",
  "product_category_id": "cat-456"
}
```

### Create a KPI Plan

```bash
POST /api/roadtour/kpi/plans
{
  "org_id": "org-123",
  "roadtour_run_id": "run-789",
  "effective_from_month": "2026-07",
  "effective_to_month": "2026-09",
  "leader_bonus_enabled": true
}
```

### Create a Team

```bash
POST /api/roadtour/kpi/teams
{
  "kpi_cycle_id": "cycle-abc",
  "team_name": "Team Alpha",
  "monthly_team_target": 15000,
  "max_incentive_per_am": 2000,
  "leader_user_id": "user-111",
  "members": [
    { "am_user_id": "user-222" },
    { "am_user_id": "user-333" },
    { "am_user_id": "user-444" }
  ]
}
```

### Get KPI Report

```bash
GET /api/roadtour/kpi/report?org_id=org-123&kpi_month=2026-07&roadtour_run_id=run-789
```

### Export Incentives to Accounting

```bash
POST /api/roadtour/kpi/incentive-export
{
  "org_id": "org-123",
  "kpi_cycle_id": "cycle-abc"
}
```

---

## 🔐 Permissions

- **Superadmin** (role_level=1): Full access across all organizations
- **HQ Admin** (role_level ≤ 20): Can manage KPI for their organization
- **Manufacturer Admin** (roles ≤ 20): Can create events

---

## 📌 Important Notes

1. **Time Zone**: All KPI calculations use Malaysia time (UTC+8)
2. **No History Rewrite**: Scan attribution is never rewritten historically
3. **Rolling Deploy Compatible**: Code supports gradual migration deployment
4. **Accounting Fallback**: Export API works even if accounting module is not active
5. **Deduplication**: 6 different policies to prevent double-scanning

---

## 🤝 Integration with Other Systems

| System                 | Integration Type                                                  |
| ---------------------- | ----------------------------------------------------------------- |
| **Finance/Accounting** | `incentive-export` exports incentives as GL journal drafts        |
| **WhatsApp**           | Scan & status notifications via `sendRoadtourClaimNotifications`  |
| **Loyalty**            | Links scans to loyalty points via `roadtour_participant_missions` |
| **Scan Issues**        | Track scan issues via `/api/scan-issues`                          |
| **Products/Catalog**   | Links events to product categories                                |
