/**
 * Unit tests for computeKpiReport — the monthly KPI performance report.
 *
 * These tests use a mock Supabase admin client so they run without a real DB.
 * The mock returns controlled data for teams, members, rules, campaigns, and
 * scan events, then we verify the report output matches expectations.
 */
import { describe, expect, it, vi } from "vitest";

import { computeKpiReport } from "./kpi-report";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAdmin(data: Record<string, any[]>) {
  const tables: Record<string, any[]> = {};
  for (const [key, rows] of Object.entries(data)) {
    tables[key] = rows;
  }

  const from = (table: string) => {
    const rows = tables[table] || [];
    let filtered = [...rows];
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: any) => {
        filtered = filtered.filter((r: any) => r[col] === val);
        return chain;
      },
      neq: (col: string, val: any) => {
        filtered = filtered.filter((r: any) => r[col] !== val);
        return chain;
      },
      in: (col: string, vals: any[]) => {
        filtered = filtered.filter((r: any) => vals.includes(r[col]));
        return chain;
      },
      gte: () => chain,
      lt: () => chain,
      or: () => chain,
      order: () => chain,
      range: (fromIdx: number, toIdx: number) => {
        filtered = filtered.slice(fromIdx, toIdx + 1);
        return chain;
      },
      maybeSingle: async () => ({ data: filtered[0] || null, error: null }),
      single: async () => ({ data: filtered[0] || null, error: null }),
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve({ data: filtered, error: null }).then(onFulfilled, onRejected),
    };
    return chain;
  };

  return { from };
}

function makeCycle(id = "cycle-1", overrides = {}) {
  return {
    id,
    org_id: "org-1",
    roadtour_run_id: "run-1",
    kpi_month: "2026-07-01",
    period_start: "2026-07-01",
    period_end: "2026-07-31",
    reporting_scope: "all_campaigns",
    status: "active",
    freeze_members_targets: true,
    lock_campaign_qr_attribution: true,
    activated_at: "2026-07-01T00:00:00+08:00",
    created_at: "2026-07-01T00:00:00+08:00",
    updated_at: "2026-07-01T00:00:00+08:00",
    ...overrides,
  };
}

function makeTeam(id: string, overrides = {}) {
  return {
    id,
    org_id: "org-1",
    kpi_cycle_id: "cycle-1",
    team_name: `Team ${id}`,
    leader_user_id: null,
    monthly_team_target: 10_000,
    incentive_budget: 2_000,
    status: "active",
    created_at: "2026-07-01T00:00:00+08:00",
    updated_at: "2026-07-01T00:00:00+08:00",
    ...overrides,
  };
}

function makeMember(amUserId: string, teamId: string, overrides = {}) {
  return {
    id: `member-${amUserId}`,
    org_id: "org-1",
    kpi_cycle_id: "cycle-1",
    team_id: teamId,
    am_user_id: amUserId,
    auto_target_scans: 2_000,
    manual_target_scans: null,
    target_source: "auto",
    created_at: "2026-07-01T00:00:00+08:00",
    ...overrides,
  };
}

function makeRule(overrides = {}) {
  return {
    id: "rule-1",
    org_id: "org-1",
    kpi_cycle_id: "cycle-1",
    team_id: null,
    rule_name: "Base AM Tier",
    applies_to: "all_ams",
    achievement_threshold_percent: 100,
    incentive_amount: 0,
    bonus_type: "cash",
    status: "active",
    created_at: "2026-07-01T00:00:00+08:00",
    updated_at: "2026-07-01T00:00:00+08:00",
    ...overrides,
  };
}

function makeCampaign(id: string, name: string) {
  return { id, name, org_id: "org-1", roadtour_run_id: "run-1" };
}

function makeScan(amUserId: string, campaignId: string) {
  return {
    account_manager_user_id: amUserId,
    campaign_id: campaignId,
    scan_status: "success",
  };
}

function makeUser(id: string, fullName: string) {
  return { id, full_name: fullName, email: `${id}@test.com` };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeKpiReport", () => {
  it("returns null when no KPI cycle exists for the month", async () => {
    const admin = mockAdmin({
      roadtour_kpi_cycles: [],
      roadtour_kpi_plans: [],
    });
    const report = await computeKpiReport(admin, {
      orgId: "org-1",
      kpiMonth: "2026-07",
      roadtourRunId: "run-1",
    });
    expect(report).toBeNull();
  });

  it("computes a full report with one team, 3 AMs, and scans", async () => {
    const admin = mockAdmin({
      roadtour_kpi_cycles: [makeCycle()],
      roadtour_kpi_teams: [makeTeam("team-1")],
      roadtour_kpi_team_members: [
        makeMember("am-1", "team-1"),
        makeMember("am-2", "team-1"),
        makeMember("am-3", "team-1"),
      ],
      roadtour_kpi_incentive_rules: [makeRule()],
      roadtour_campaigns: [makeCampaign("camp-1", "Campaign Alpha")],
      roadtour_scan_events: [
        makeScan("am-1", "camp-1"),
        makeScan("am-1", "camp-1"),
        makeScan("am-1", "camp-1"),
        makeScan("am-2", "camp-1"),
        makeScan("am-2", "camp-1"),
        makeScan("am-3", "camp-1"),
      ],
      users: [
        makeUser("am-1", "Alice"),
        makeUser("am-2", "Bob"),
        makeUser("am-3", "Charlie"),
      ],
    });

    const report = await computeKpiReport(admin, {
      orgId: "org-1",
      kpiMonth: "2026-07",
      roadtourRunId: "run-1",
    });

    expect(report).not.toBeNull();
    if (!report) return;

    // Cycle info
    expect(report.cycle.kpi_month).toBe("2026-07");
    expect(report.cycle.status).toBe("active");

    // Summary
    expect(report.summary.total_team_target).toBe(10_000);
    expect(report.summary.actual_scans).toBe(6);
    expect(report.summary.ams_total).toBe(3);
    expect(report.summary.teams_total).toBe(1);

    // Team row
    expect(report.teams).toHaveLength(1);
    const team = report.teams[0];
    expect(team.team_name).toBe("Team team-1");
    expect(team.team_target).toBe(10_000);
    expect(team.actual_scans).toBe(6);
    expect(team.member_count).toBe(3);

    // AM rows — ranked by achievement
    expect(report.ams).toHaveLength(3);
    // am-1 has 3 scans / 2000 target = 0.15% → rank 1
    // am-2 has 2 scans / 2000 target = 0.10% → rank 2
    // am-3 has 1 scan  / 2000 target = 0.05% → rank 3
    expect(report.ams[0].am_user_id).toBe("am-1");
    expect(report.ams[0].rank).toBe(1);
    expect(report.ams[0].actual_scans).toBe(3);
    expect(report.ams[1].am_user_id).toBe("am-2");
    expect(report.ams[1].rank).toBe(2);
    expect(report.ams[1].actual_scans).toBe(2);
    expect(report.ams[2].am_user_id).toBe("am-3");
    expect(report.ams[2].rank).toBe(3);
    expect(report.ams[2].actual_scans).toBe(1);

    // Top campaigns
    expect(report.top_campaigns).toHaveLength(1);
    expect(report.top_campaigns[0].campaign_name).toBe("Campaign Alpha");
    expect(report.top_campaigns[0].actual_scans).toBe(6);

    // Charts
    expect(report.chart_team_achievement).toHaveLength(1);
    expect(report.chart_payout_by_team).toHaveLength(1);
  });

  it("handles unassigned scans (AM not in any team)", async () => {
    const admin = mockAdmin({
      roadtour_kpi_cycles: [makeCycle()],
      roadtour_kpi_teams: [makeTeam("team-1")],
      roadtour_kpi_team_members: [makeMember("am-1", "team-1")],
      roadtour_kpi_incentive_rules: [makeRule()],
      roadtour_campaigns: [makeCampaign("camp-1", "Campaign Alpha")],
      roadtour_scan_events: [
        makeScan("am-1", "camp-1"),
        makeScan("ghost", "camp-1"), // unassigned AM
        makeScan("ghost", "camp-1"),
      ],
      users: [makeUser("am-1", "Alice")],
    });

    const report = await computeKpiReport(admin, {
      orgId: "org-1",
      kpiMonth: "2026-07",
      roadtourRunId: "run-1",
    });

    expect(report).not.toBeNull();
    if (!report) return;

    // Only assigned AM scans count toward team actual
    expect(report.summary.actual_scans).toBe(1);
    // Unassigned scans are reported separately
    expect(report.summary.unassigned_scans).toBe(2);
  });

  it("handles zero scans gracefully", async () => {
    const admin = mockAdmin({
      roadtour_kpi_cycles: [makeCycle()],
      roadtour_kpi_teams: [makeTeam("team-1")],
      roadtour_kpi_team_members: [makeMember("am-1", "team-1")],
      roadtour_kpi_incentive_rules: [makeRule()],
      roadtour_campaigns: [makeCampaign("camp-1", "Campaign Alpha")],
      roadtour_scan_events: [],
      users: [makeUser("am-1", "Alice")],
    });

    const report = await computeKpiReport(admin, {
      orgId: "org-1",
      kpiMonth: "2026-07",
      roadtourRunId: "run-1",
    });

    expect(report).not.toBeNull();
    if (!report) return;

    expect(report.summary.actual_scans).toBe(0);
    expect(report.summary.overall_achievement_percent).toBe(0);
    expect(report.ams[0].actual_scans).toBe(0);
    expect(report.ams[0].achievement_percent).toBe(0);
    expect(report.ams[0].status).toBe("needs_focus");
    expect(report.top_campaigns).toHaveLength(0);
  });

  it("applies team_id filter correctly", async () => {
    const admin = mockAdmin({
      roadtour_kpi_cycles: [makeCycle()],
      roadtour_kpi_teams: [
        makeTeam("team-1", { team_name: "Alpha" }),
        makeTeam("team-2", { team_name: "Beta" }),
      ],
      roadtour_kpi_team_members: [
        makeMember("am-1", "team-1"),
        makeMember("am-2", "team-2"),
      ],
      roadtour_kpi_incentive_rules: [makeRule()],
      roadtour_campaigns: [makeCampaign("camp-1", "Campaign Alpha")],
      roadtour_scan_events: [
        makeScan("am-1", "camp-1"),
        makeScan("am-2", "camp-1"),
      ],
      users: [makeUser("am-1", "Alice"), makeUser("am-2", "Bob")],
    });

    const report = await computeKpiReport(admin, {
      orgId: "org-1",
      kpiMonth: "2026-07",
      roadtourRunId: "run-1",
      teamId: "team-1",
    });

    expect(report).not.toBeNull();
    if (!report) return;

    expect(report.teams).toHaveLength(1);
    expect(report.teams[0].team_id).toBe("team-1");
    expect(report.ams).toHaveLength(1);
    expect(report.ams[0].am_user_id).toBe("am-1");
  });

  it("computes incentive payouts correctly with volume tiers", async () => {
    const scanAm1 = makeScan("am-1", "camp-1");
    const admin = mockAdmin({
      roadtour_kpi_cycles: [makeCycle()],
      roadtour_kpi_teams: [
        makeTeam("team-1", {
          monthly_team_target: 50_000,
          incentive_budget: 5_000,
        }),
      ],
      roadtour_kpi_team_members: [
        makeMember("am-1", "team-1", { auto_target_scans: 25_000 }),
      ],
      roadtour_kpi_incentive_rules: [makeRule()],
      roadtour_campaigns: [makeCampaign("camp-1", "Campaign Alpha")],
      // Reuse one scan object to avoid allocating 25k heap objects in the test runner.
      roadtour_scan_events: Array.from({ length: 25_000 }, () => scanAm1),
      users: [makeUser("am-1", "Alice")],
    });

    const report = await computeKpiReport(admin, {
      orgId: "org-1",
      kpiMonth: "2026-07",
      roadtourRunId: "run-1",
    });

    expect(report).not.toBeNull();
    if (!report) return;

    // Progressive tiers for 25,000 scans:
    // 10,001-20,000 => 10,000 × 0.10 = 1,000
    // 20,001-25,000 => 5,000 × 0.12 = 600
    // Total = 1,600 (below cap 5,000)
    expect(report.ams[0].volume_incentive).toBe(1_600);
    expect(report.ams[0].incentive_earned).toBe(1_600);
    expect(report.ams[0].volume_tier_rate).toBe(0.12);
    expect(report.summary.incentive_estimated_payout).toBe(1_600);
  });

  it("handles leader bonus with team achievement", async () => {
    const admin = mockAdmin({
      roadtour_kpi_cycles: [makeCycle()],
      roadtour_kpi_teams: [
        makeTeam("team-1", {
          monthly_team_target: 10,
          incentive_budget: 1_000,
          leader_user_id: "leader-1",
        }),
      ],
      roadtour_kpi_team_members: [
        makeMember("am-1", "team-1", { auto_target_scans: 10 }),
      ],
      roadtour_kpi_incentive_rules: [
        makeRule({
          applies_to: "all_ams",
          achievement_threshold_percent: 100,
          incentive_amount: 0,
        }),
        makeRule({
          id: "leader-rule",
          rule_name: "Leader Bonus",
          applies_to: "team_leader",
          achievement_threshold_percent: 100,
          incentive_amount: 500,
        }),
      ],
      roadtour_campaigns: [makeCampaign("camp-1", "Campaign Alpha")],
      roadtour_scan_events: Array.from({ length: 10 }, () =>
        makeScan("am-1", "camp-1"),
      ),
      users: [makeUser("am-1", "Alice"), makeUser("leader-1", "Leader")],
    });

    const report = await computeKpiReport(admin, {
      orgId: "org-1",
      kpiMonth: "2026-07",
      roadtourRunId: "run-1",
    });

    expect(report).not.toBeNull();
    if (!report) return;

    // Team achieved 100% → leader gets RM500 bonus
    expect(report.teams[0].estimated_payout).toBe(500); // 0 AM incentive + 500 leader bonus
    expect(report.teams[0].achievement_percent).toBe(100);
    expect(report.teams[0].status).toBe("achieved");
  });
});
