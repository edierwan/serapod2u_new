import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'

import { KPI_STATUS_LABEL, formatKpiMonthLabel, isValidKpiMonth, type KpiPerformanceStatus, type KpiPeriodType } from '@/lib/roadtour/kpi'
import { computeKpiReport } from '@/lib/roadtour/kpi-report'
import { assertOrgAccess, jsonError, requireKpiAdmin } from '../../_lib'

export const dynamic = 'force-dynamic'

const ALLOWED_STATUS = new Set<KpiPerformanceStatus>(['achieved', 'on_track', 'at_risk', 'needs_focus'])
const ALLOWED_PERIOD_TYPES = new Set<KpiPeriodType>(['weekly', 'monthly', 'quarterly', 'yearly'])

const HEADER_FILL: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E40AF' },
}

function styleHeader(row: ExcelJS.Row) {
    row.eachCell((cell) => {
        cell.fill = HEADER_FILL
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true }
        cell.alignment = { vertical: 'middle' }
    })
}

export async function GET(request: NextRequest) {
    try {
        const ctx = await requireKpiAdmin()
        if (ctx instanceof NextResponse) return ctx

        const { searchParams } = new URL(request.url)
        const orgId = String(searchParams.get('org_id') || ctx.profile.organization_id || '').trim()
        const denied = assertOrgAccess(ctx, orgId)
        if (denied) return denied

        const kpiMonth = String(searchParams.get('kpi_month') || '').trim()
        const periodType = String(searchParams.get('period_type') || 'monthly').trim() as KpiPeriodType
        const runId = String(searchParams.get('roadtour_run_id') || '').trim()
        if (!isValidKpiMonth(kpiMonth)) return jsonError('KPI month must be in YYYY-MM format.')
        if (!ALLOWED_PERIOD_TYPES.has(periodType)) return jsonError('period_type must be one of: weekly, monthly, quarterly, yearly.')
        if (!runId) return jsonError('RoadTour Event is required.')
        const statusParam = String(searchParams.get('status') || '').trim() as KpiPerformanceStatus

        const report = await computeKpiReport(ctx.admin, {
            orgId,
            kpiMonth,
            periodType,
            roadtourRunId: runId,
            teamId: String(searchParams.get('team_id') || '').trim() || null,
            leaderUserId: String(searchParams.get('leader_id') || '').trim() || null,
            status: ALLOWED_STATUS.has(statusParam) ? statusParam : null,
        })
        if (!report) return jsonError('No KPI Plan report data for the selected month and event.', 404)

        const wb = new ExcelJS.Workbook()
        wb.creator = 'Serapod2U RoadTour KPI'
        wb.created = new Date()

        const summary = wb.addWorksheet('Summary')
        summary.columns = [
            { header: 'Metric', key: 'metric', width: 32 },
            { header: 'Value', key: 'value', width: 36 },
        ]
        styleHeader(summary.getRow(1))
        summary.addRows([
            { metric: 'Report', value: `${report.cycle.period_type[0].toUpperCase()}${report.cycle.period_type.slice(1)} KPI Performance Report` },
            { metric: 'Anchor Month', value: formatKpiMonthLabel(report.cycle.kpi_month) },
            { metric: 'Period (auto)', value: report.cycle.period_label },
            { metric: 'Period Type', value: report.cycle.period_type },
            { metric: 'Plan Status', value: report.cycle.status },
            { metric: 'Total Team Target (scans)', value: report.summary.total_team_target },
            { metric: 'Actual Scans', value: report.summary.actual_scans },
            { metric: 'Overall Achievement', value: `${report.summary.overall_achievement_percent.toFixed(1)}%` },
            { metric: 'AMs Achieved KPI', value: `${report.summary.ams_achieved} / ${report.summary.ams_total}` },
            { metric: 'Incentive Estimated Payout', value: `RM ${report.summary.incentive_estimated_payout.toFixed(2)}` },
            { metric: 'Teams On Track', value: `${report.summary.teams_on_track} / ${report.summary.teams_total}` },
            { metric: 'Generated At', value: new Date().toISOString() },
        ])

        const teamSheet = wb.addWorksheet('Team KPI Performance')
        teamSheet.columns = [
            { header: 'Team Name', key: 'team', width: 26 },
            { header: 'Leader', key: 'leader', width: 22 },
            { header: 'Members', key: 'members', width: 10 },
            { header: 'Team Target (Scans)', key: 'target', width: 18 },
            { header: 'Actual Scans', key: 'actual', width: 14 },
            { header: 'Achievement %', key: 'percent', width: 15 },
            { header: 'Max Incentive / AM (RM)', key: 'budget', width: 22 },
            { header: 'Est. Payout (RM)', key: 'payout', width: 17 },
            { header: 'Status', key: 'status', width: 14 },
        ]
        styleHeader(teamSheet.getRow(1))
        for (const t of report.teams) {
            teamSheet.addRow({
                team: t.team_name,
                leader: t.leader_name,
                members: t.member_count,
                target: t.team_target,
                actual: t.actual_scans,
                percent: Number(t.achievement_percent.toFixed(1)),
                budget: Number(t.incentive_budget.toFixed(2)),
                payout: Number(t.estimated_payout.toFixed(2)),
                status: KPI_STATUS_LABEL[t.status],
            })
        }

        const amSheet = wb.addWorksheet('AM Achievement Breakdown')
        amSheet.columns = [
            { header: 'Rank', key: 'rank', width: 8 },
            { header: 'AM Name', key: 'name', width: 24 },
            { header: 'Team', key: 'team', width: 26 },
            { header: 'Assigned Target (Scans)', key: 'target', width: 20 },
            { header: 'Actual Scans', key: 'actual', width: 14 },
            { header: 'Tier RM/scan', key: 'tier_rate', width: 14 },
            { header: 'Volume Payout (RM)', key: 'volume_base', width: 18 },
            { header: 'Achievement %', key: 'percent', width: 15 },
            { header: 'Total Incentive (RM)', key: 'incentive', width: 20 },
            { header: 'Status', key: 'status', width: 14 },
        ]
        styleHeader(amSheet.getRow(1))
        for (const a of report.ams) {
            amSheet.addRow({
                rank: a.rank,
                name: a.am_name,
                team: a.team_name,
                target: a.assigned_target,
                actual: a.actual_scans,
                tier_rate: a.volume_tier_rate != null && a.volume_tier_rate > 0
                    ? Number(a.volume_tier_rate.toFixed(2))
                    : 0,
                volume_base: Number(a.volume_incentive.toFixed(2)),
                percent: Number(a.achievement_percent.toFixed(1)),
                incentive: Number(a.incentive_earned.toFixed(2)),
                status: KPI_STATUS_LABEL[a.status],
            })
        }

        const campaignSheet = wb.addWorksheet('Top Campaigns')
        campaignSheet.columns = [
            { header: 'Rank', key: 'rank', width: 8 },
            { header: 'Campaign / Shop', key: 'campaign', width: 36 },
            { header: 'Team', key: 'team', width: 26 },
            { header: 'Actual Scans', key: 'actual', width: 14 },
            { header: '% of Total', key: 'percent', width: 12 },
        ]
        styleHeader(campaignSheet.getRow(1))
        for (const c of report.top_campaigns) {
            campaignSheet.addRow({
                rank: c.rank,
                campaign: c.campaign_name,
                team: c.team_name,
                actual: c.actual_scans,
                percent: `${c.percent_of_total.toFixed(1)}%`,
            })
        }

        const buffer = await wb.xlsx.writeBuffer()
        const filename = `roadtour-${report.cycle.period_type}-kpi-${report.cycle.kpi_month}.xlsx`
        return new Response(buffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'no-store',
            },
        })
    } catch (error: any) {
        console.error('RoadTour KPI report Excel API error:', error)
        return jsonError(error.message || 'Export failed', 500)
    }
}
