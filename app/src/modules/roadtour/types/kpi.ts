import type {
    KpiBonusType,
    KpiCycleStatus,
    KpiPerformanceStatus,
    KpiReportingScope,
    KpiRuleAppliesTo,
    KpiTeamStatus,
} from '@/lib/roadtour/kpi'

export interface KpiTeamMemberRow {
    id: string
    org_id: string
    kpi_cycle_id: string
    team_id: string
    am_user_id: string
    auto_target_scans: number
    manual_target_scans: number | null
    target_source: 'auto' | 'manual'
    created_at: string
}

export interface KpiTeamRow {
    id: string
    org_id: string
    kpi_cycle_id: string
    team_name: string
    leader_user_id: string | null
    monthly_team_target: number
    incentive_budget: number
    status: KpiTeamStatus
    created_at: string
    updated_at: string
    members: KpiTeamMemberRow[]
}

export interface KpiIncentiveRuleRow {
    id: string
    org_id: string
    kpi_cycle_id: string
    team_id: string | null
    rule_name: string
    applies_to: KpiRuleAppliesTo
    achievement_threshold_percent: number
    incentive_amount: number
    bonus_type: KpiBonusType
    status: 'active' | 'inactive'
    created_at: string
    updated_at: string
}

export interface KpiCycleRow {
    id: string
    org_id: string
    roadtour_run_id: string
    kpi_month: string // 'YYYY-MM-01' date value from the API
    period_start: string
    period_end: string
    reporting_scope: KpiReportingScope
    status: KpiCycleStatus
    freeze_members_targets: boolean
    lock_campaign_qr_attribution: boolean
    activated_at: string | null
    created_at: string
    updated_at: string
    teams: KpiTeamRow[]
    rules: KpiIncentiveRuleRow[]
}

export type KpiPlanStatus = 'draft' | 'active' | 'archived'

export interface KpiPlanRow {
    id: string
    org_id: string
    roadtour_run_id: string
    plan_name: string | null
    effective_from_month: string // 'YYYY-MM-01'
    effective_to_month: string | null // 'YYYY-MM-01' or null (open-ended)
    reporting_scope: KpiReportingScope
    status: KpiPlanStatus
    leader_bonus_enabled: boolean
    config_cycle_id: string | null
    activated_at: string | null
    created_at: string
    updated_at: string
    // Nested config (from the plan's config cycle).
    teams: KpiTeamRow[]
    rules: KpiIncentiveRuleRow[]
}

export interface KpiAmOption {
    id: string
    full_name: string
    email: string
    phone: string
}

export interface KpiReportSummaryData {
    total_team_target: number
    actual_scans: number
    overall_achievement_percent: number
    ams_achieved: number
    ams_total: number
    incentive_estimated_payout: number
    teams_on_track: number
    teams_total: number
    unassigned_scans: number
}

export interface KpiReportTeamRowData {
    team_id: string
    team_name: string
    leader_user_id: string | null
    leader_name: string
    member_count: number
    team_target: number
    actual_scans: number
    achievement_percent: number
    incentive_budget: number
    estimated_payout: number
    status: KpiPerformanceStatus
}

export interface KpiReportAmRowData {
    am_user_id: string
    am_name: string
    team_id: string
    team_name: string
    assigned_target: number
    actual_scans: number
    achievement_percent: number
    incentive_earned: number
    rank: number
    status: KpiPerformanceStatus
}

export interface KpiReportCampaignRowData {
    rank: number
    campaign_id: string
    campaign_name: string
    team_name: string
    actual_scans: number
    percent_of_total: number
}

export interface KpiReportData {
    cycle: {
        id: string
        kpi_month: string // 'YYYY-MM'
        status: KpiCycleStatus
        period_label: string
        period_start: string
        period_end: string
        freeze_members_targets: boolean
        lock_campaign_qr_attribution: boolean
    }
    summary: KpiReportSummaryData
    teams: KpiReportTeamRowData[]
    ams: KpiReportAmRowData[]
    top_campaigns: KpiReportCampaignRowData[]
    chart_team_achievement: { team_name: string; target: number; actual: number; achievement_percent: number }[]
    chart_payout_by_team: { team_name: string; payout: number }[]
}
