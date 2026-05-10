import 'server-only'

// ── KPI domain enums (kept in sync with sql/staging/010_kpi_core_schema.sql) ─

export const KPI_PERSPECTIVES = [
    'Financial',
    'Customer',
    'Internal Process',
    'Learning & Growth',
    'Operations',
    'People',
] as const
export type KpiPerspective = typeof KPI_PERSPECTIVES[number]

export const KPI_UNITS = ['%', 'count', 'hours', 'days', 'RM', 'score', 'ratio'] as const

export const KPI_DIRECTIONS = ['higher_is_better', 'lower_is_better', 'target_band'] as const
export type KpiDirection = typeof KPI_DIRECTIONS[number]

export const KPI_CALC_TYPES = ['manual', 'auto', 'hybrid'] as const
export type KpiCalcType = typeof KPI_CALC_TYPES[number]

export const KPI_DATA_SOURCE_STATUSES = ['unmapped', 'draft', 'mapped', 'failed'] as const

export const KPI_PERIOD_TYPES = ['monthly', 'quarterly', 'semi_annual', 'yearly', 'custom'] as const

export const KPI_LEVELS = ['company', 'department', 'role', 'employee'] as const
export type KpiLevel = typeof KPI_LEVELS[number]

export const KPI_OBJECTIVE_STATUSES = [
    'draft', 'active', 'at_risk', 'on_track', 'completed', 'archived',
] as const

export const KPI_SCORECARD_STATUSES = [
    'draft', 'generated', 'submitted', 'manager_review',
    'calibration', 'final_review', 'completed', 'locked',
] as const

export const KPI_REVIEW_STAGES = [
    'self_review', 'manager_review', 'calibration', 'final_review', 'completed',
] as const

export const KPI_ITEM_STATUSES = ['on_track', 'at_risk', 'below_target', 'no_data'] as const

// ── Default settings (mirror hr_kpi_settings defaults) ──────────────────

export const KPI_DEFAULT_SETTINGS = {
    green_threshold: 90,
    yellow_threshold: 70,
    red_threshold: 0,
    achievement_cap: 150,
    grade_table: [
        { grade: 'A+', min: 95 },
        { grade: 'A', min: 85 },
        { grade: 'B+', min: 75 },
        { grade: 'B', min: 65 },
        { grade: 'C', min: 50 },
        { grade: 'D', min: 0 },
    ],
}
