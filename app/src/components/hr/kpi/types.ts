// Shared types for the redesigned HR > Performance > KPIs tabs.
// Matches existing API response shapes (no schema changes).

export interface Period {
    id: string
    name: string
    period_type: string
    start_date: string
    end_date: string
    status: string
    owner_user_id?: string | null
    created_by?: string | null
    locked_at?: string | null
}

export interface Objective {
    id: string
    objective_code: string
    title: string
    description?: string | null
    perspective: string | null
    status: string
    period_id: string
    progress_percent: number
    owner_user_id?: string | null
    start_date?: string | null
    end_date?: string | null
    created_at?: string | null
    updated_at?: string | null
    hr_kpi_periods?: { name: string; status: string }
}

export interface Metric {
    id: string
    kpi_code: string
    name: string
    description?: string | null
    unit: string
    perspective: string | null
    measurement_direction: string
    calculation_type: string
    data_source_status: string
    status: string
    is_active: boolean
    owner_user_id?: string | null
    tags?: string[] | null
    formula_config?: any
    updated_at?: string | null
}

export interface KpiTarget {
    id: string
    period_id: string
    metric_id: string
    target_value: number
    weight_percent: number
    status: string
    hr_kpi_periods?: { name: string; period_type?: string }
    hr_kpi_metrics?: { kpi_code: string; name: string; unit: string; perspective?: string | null }
}

export interface DashboardSummary {
    period_id: string | null
    scorecards: {
        total: number
        by_status?: Record<string, number>
        by_level?: Record<string, number>
        avg_overall_score: number | null
    }
    items: { total: number; by_status?: Record<string, number> }
    perspectives: Array<{ perspective: string; count: number; avg_score: number | null }>
}

export async function kpiFetch<T = any>(
    path: string,
    init?: RequestInit,
): Promise<{ success: boolean; data?: T; error?: string }> {
    try {
        const res = await fetch(path, {
            ...init,
            headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
        })
        try { return await res.json() } catch { return { success: false, error: `HTTP ${res.status}` } }
    } catch (e: any) {
        return { success: false, error: e?.message ?? 'Network error' }
    }
}

export function formatDate(d?: string | null): string {
    if (!d) return '—'
    try {
        return new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' })
    } catch { return d }
}

export function formatDateRange(start?: string | null, end?: string | null): string {
    if (!start && !end) return '—'
    return `${formatDate(start)} – ${formatDate(end)}`
}

export const PERSPECTIVE_OPTIONS = [
    'financial',
    'customer',
    'internal_process',
    'process',
    'learning_growth',
    'people',
    'operations',
    'quality',
] as const
