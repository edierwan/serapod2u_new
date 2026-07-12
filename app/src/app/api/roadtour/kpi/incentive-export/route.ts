/**
 * POST /api/roadtour/kpi/incentive-export
 *
 * Exports KPI incentive data from a completed KPI cycle to the accounting
 * module as a GL journal draft. This bridges RoadTour → Finance:
 * the estimated incentive payouts for each AM and team leader become
 * journal entries ready for approval in accounting.
 *
 * Request body:
 * {
 *   org_id: string
 *   kpi_cycle_id: string       // The cycle to export
 *   journal_date?: string      // Defaults to cycle end date
 *   description?: string       // Custom journal description
 * }
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     journal_id: string,
 *     entries: Array<{ am_name, incentive_earned, type }>,
 *     total_amount: number
 *   }
 * }
 */
import { NextRequest, NextResponse } from "next/server";

import { computeKpiReport } from "@/lib/roadtour/kpi-report";
import { kpiMonthFromDate } from "@/lib/roadtour/kpi";
import { assertOrgAccess, jsonError, requireKpiAdmin } from "../_lib";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireKpiAdmin();
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json();
    const orgId = String(
      body?.org_id || ctx.profile.organization_id || "",
    ).trim();
    const denied = assertOrgAccess(ctx, orgId);
    if (denied) return denied;

    const cycleId = String(body?.kpi_cycle_id || "").trim();
    if (!cycleId) return jsonError("kpi_cycle_id is required.");

    // 1. Load the cycle to get its org, event, and month
    const { data: cycle, error: cycleError } = await ctx.admin
      .from("roadtour_kpi_cycles")
      .select("id, org_id, roadtour_run_id, kpi_month, period_end, status")
      .eq("id", cycleId)
      .maybeSingle();
    if (cycleError) return jsonError(cycleError.message, 500);
    if (!cycle) return jsonError("KPI cycle not found.", 404);
    if (cycle.org_id !== orgId)
      return jsonError("Access denied for this cycle.", 403);
    if (cycle.status !== "active" && cycle.status !== "closed") {
      return jsonError(
        "Only active or closed cycles can be exported to accounting.",
        409,
      );
    }

    // 2. Compute the KPI report for this cycle
    const kpiMonth = kpiMonthFromDate(cycle.kpi_month);
    const report = await computeKpiReport(ctx.admin, {
      orgId,
      kpiMonth,
      roadtourRunId: cycle.roadtour_run_id,
    });
    if (!report)
      return jsonError(
        "No KPI data found for this cycle. Has it been configured?",
        404,
      );

    // 3. Build incentive entry lines
    const entries: Array<{
      am_user_id: string;
      am_name: string;
      team_name: string;
      type: "am_incentive" | "leader_bonus";
      amount: number;
    }> = [];

    // Individual AM incentives
    for (const am of report.ams) {
      if (am.incentive_earned > 0) {
        entries.push({
          am_user_id: am.am_user_id,
          am_name: am.am_name,
          team_name: am.team_name,
          type: "am_incentive",
          amount: am.incentive_earned,
        });
      }
    }

    // Leader bonuses (team estimated_payout minus sum of AM incentives)
    for (const team of report.teams) {
      const teamAmIncentives = entries
        .filter(
          (e) => e.team_name === team.team_name && e.type === "am_incentive",
        )
        .reduce((sum, e) => sum + e.amount, 0);
      const leaderBonus = team.estimated_payout - teamAmIncentives;
      if (leaderBonus > 0 && team.leader_user_id) {
        entries.push({
          am_user_id: team.leader_user_id,
          am_name: team.leader_name,
          team_name: team.team_name,
          type: "leader_bonus",
          amount: leaderBonus,
        });
      }
    }

    if (entries.length === 0) {
      return jsonError("No incentive entries to export for this cycle.", 404);
    }

    const totalAmount = entries.reduce((sum, e) => sum + e.amount, 0);

    // 4. Create a GL journal draft in accounting
    const journalDate = body?.journal_date || cycle.period_end;
    const description =
      body?.description ||
      `RoadTour KPI Incentives — ${report.cycle.period_label}`;

    const { data: journal, error: journalError } = await ctx.admin
      .from("accounting_journals")
      .insert({
        org_id: orgId,
        journal_type: "roadtour_incentive",
        journal_date: journalDate,
        description,
        reference: `RT-KPI-${cycle.id.slice(0, 8)}`,
        status: "draft",
        total_amount: totalAmount,
        created_by: ctx.profile.id,
        updated_by: ctx.profile.id,
        metadata: {
          source: "roadtour_kpi",
          kpi_cycle_id: cycleId,
          kpi_month: kpiMonth,
          entries_count: entries.length,
        },
      })
      .select("id")
      .single();
    if (journalError) {
      // Fallback if the accounting_journals table doesn't exist or schema differs
      if (
        journalError.code === "42P01" ||
        String(journalError.message || "").includes("does not exist")
      ) {
        return NextResponse.json({
          success: true,
          data: {
            journal_id: null,
            note: "Accounting module not available. Incentive data returned for manual processing.",
            entries,
            total_amount: totalAmount,
            kpi_month: kpiMonth,
          },
        });
      }
      return jsonError(
        journalError.message || "Failed to create GL journal.",
        500,
      );
    }

    // 5. Create journal line items for each entry
    const lineItems: any[] = entries.map((e) => ({
      journal_id: journal.id,
      org_id: orgId,
      account_code:
        e.type === "leader_bonus" ? "INCENTIVE-LEADER" : "INCENTIVE-AM",
      description: `${e.type === "leader_bonus" ? "Leader Bonus" : "AM Incentive"} — ${e.am_name} (${e.team_name})`,
      debit_amount: 0,
      credit_amount: e.amount,
      reference_user_id: e.am_user_id,
      created_by: ctx.profile.id,
    }));
    // Add the offsetting expense entry
    lineItems.push({
      journal_id: journal.id,
      org_id: orgId,
      account_code: "INCENTIVE-EXPENSE",
      description: `RoadTour KPI Incentive Expense — ${report.cycle.period_label}`,
      debit_amount: totalAmount,
      credit_amount: 0,
      created_by: ctx.profile.id,
    });

    const { error: linesError } = await ctx.admin
      .from("accounting_journal_lines")
      .insert(lineItems);
    if (linesError) {
      // Non-fatal: the journal draft is already created
      console.error(
        "Failed to insert KPI incentive journal lines:",
        linesError,
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          journal_id: journal.id,
          entries,
          total_amount: totalAmount,
          kpi_month: kpiMonth,
        },
      },
      { status: 201 },
    );
  } catch (error: any) {
    console.error("RoadTour KPI incentive export API error:", error);
    return jsonError(error.message || "Internal server error", 500);
  }
}
