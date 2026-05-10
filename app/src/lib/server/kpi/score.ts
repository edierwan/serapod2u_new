import 'server-only'
import type { KpiDirection } from './constants'

/**
 * Compute achievement percentage. Mirrors public.kpi_compute_achievement.
 * Returns null when input is insufficient.
 */
export function computeAchievementPct(
    direction: KpiDirection,
    target: number | null | undefined,
    actual: number | null | undefined,
    formulaConfig: Record<string, any> = {},
): number | null {
    if (target == null || actual == null) return null

    if (direction === 'higher_is_better') {
        if (target === 0) return actual === 0 ? 100 : null
        return round2((actual / target) * 100)
    }
    if (direction === 'lower_is_better') {
        if (actual === 0) return target === 0 ? 100 : 200
        return round2((target / actual) * 100)
    }
    if (direction === 'target_band') {
        const min = Number(formulaConfig.band_min ?? target * 0.9)
        const max = Number(formulaConfig.band_max ?? target * 1.1)
        if (actual >= min && actual <= max) return 100
        if (actual < min) return min === 0 ? 0 : round2(Math.max(0, (actual / min) * 100))
        return actual === 0 ? 0 : round2(Math.max(0, (max / actual) * 100))
    }
    return null
}

export function computeWeightedScore(
    achievementPct: number | null,
    weightPct: number | null,
    capPct = 150,
): number | null {
    if (achievementPct == null || weightPct == null) return null
    return round2((Math.min(achievementPct, capPct) * weightPct) / 100)
}

export function classifyStatus(
    achievementPct: number | null,
    green = 90,
    yellow = 70,
): 'on_track' | 'at_risk' | 'below_target' | 'no_data' {
    if (achievementPct == null) return 'no_data'
    if (achievementPct >= green) return 'on_track'
    if (achievementPct >= yellow) return 'at_risk'
    return 'below_target'
}

export function computeGrade(
    score: number | null,
    gradeTable: { grade: string; min: number }[] = [
        { grade: 'A+', min: 95 }, { grade: 'A', min: 85 },
        { grade: 'B+', min: 75 }, { grade: 'B', min: 65 },
        { grade: 'C', min: 50 }, { grade: 'D', min: 0 },
    ],
): string | null {
    if (score == null) return null
    const sorted = [...gradeTable].sort((a, b) => b.min - a.min)
    for (const row of sorted) {
        if (score >= row.min) return row.grade
    }
    return null
}

function round2(n: number) {
    return Math.round(n * 100) / 100
}
