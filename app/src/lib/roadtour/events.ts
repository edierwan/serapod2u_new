/**
 * Shared RoadTour Event helpers (client-side).
 * Backed by the public.roadtour_runs table introduced 2026-05-12.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
    DUPLICATE_POLICY_LABEL,
    DUPLICATE_POLICY_OPTIONS,
    type RoadtourDuplicatePolicy,
} from './duplicate-protection'

export { DUPLICATE_POLICY_LABEL, DUPLICATE_POLICY_OPTIONS }

export type RoadtourRunStatus = 'draft' | 'active' | 'completed' | 'cancelled'
export type RoadtourPointReleaseRule = 'immediate_after_roadtour_claim' | 'product_qr_scan_target_once'
export type RoadtourProductQrCountingPeriod = 'rolling_1_month' | 'rolling_2_months' | 'open_period'
export type { RoadtourDuplicatePolicy }

export interface RoadtourRun {
    id: string
    org_id: string
    name: string
    description: string | null
    start_date: string
    end_date: string
    status: RoadtourRunStatus
    duplicate_policy: RoadtourDuplicatePolicy
    point_release_rule: RoadtourPointReleaseRule
    required_product_qr_scans: number | null
    product_qr_counting_period: RoadtourProductQrCountingPeriod | null
    unique_product_qr_only: boolean
    active_reward_rule_version_id: string | null
    created_at: string
    updated_at: string
}

export const STATUS_LABEL: Record<RoadtourRunStatus, string> = {
    draft: 'Draft',
    active: 'Active',
    completed: 'Completed',
    cancelled: 'Cancelled',
}

export const POINT_RELEASE_RULE_LABEL: Record<RoadtourPointReleaseRule, string> = {
    immediate_after_roadtour_claim: 'Immediate after RoadTour claim',
    product_qr_scan_target_once: 'Release once after Product QR scan target',
}

export const PRODUCT_QR_COUNTING_PERIOD_LABEL: Record<RoadtourProductQrCountingPeriod, string> = {
    rolling_1_month: '1 month from enrollment',
    rolling_2_months: '2 months from enrollment',
    open_period: 'Open period',
}

export async function fetchRoadtourRuns(
    supabase: SupabaseClient,
    orgId: string,
): Promise<RoadtourRun[]> {
    const { data, error } = await (supabase as any)
        .from('roadtour_runs')
        .select('id, org_id, name, description, start_date, end_date, status, duplicate_policy, point_release_rule, required_product_qr_scans, product_qr_counting_period, unique_product_qr_only, active_reward_rule_version_id, created_at, updated_at')
        .eq('org_id', orgId)
        .order('start_date', { ascending: false })
    if (error) throw error
    return (data || []) as RoadtourRun[]
}

export async function fetchActiveOrDraftRoadtourRuns(
    supabase: SupabaseClient,
    orgId: string,
): Promise<RoadtourRun[]> {
    const all = await fetchRoadtourRuns(supabase, orgId)
    return all.filter((r) => r.status === 'draft' || r.status === 'active')
}

export interface CreateRoadtourRunInput {
    org_id: string
    name: string
    description?: string | null
    start_date: string
    end_date: string
    status?: RoadtourRunStatus
    duplicate_policy?: RoadtourDuplicatePolicy
    point_release_rule?: RoadtourPointReleaseRule
    required_product_qr_scans?: number | null
    product_qr_counting_period?: RoadtourProductQrCountingPeriod | null
    unique_product_qr_only?: boolean
    created_by?: string | null
}

export async function createRoadtourRun(
    supabase: SupabaseClient,
    input: CreateRoadtourRunInput,
): Promise<RoadtourRun> {
    const payload = {
        org_id: input.org_id,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        start_date: input.start_date,
        end_date: input.end_date,
        status: input.status ?? 'active',
        duplicate_policy: input.duplicate_policy ?? 'one_participant_once_per_event',
        point_release_rule: input.point_release_rule ?? 'immediate_after_roadtour_claim',
        required_product_qr_scans: input.point_release_rule === 'product_qr_scan_target_once' ? input.required_product_qr_scans ?? 1 : null,
        product_qr_counting_period: input.point_release_rule === 'product_qr_scan_target_once' ? input.product_qr_counting_period ?? 'rolling_1_month' : null,
        unique_product_qr_only: true,
        created_by: input.created_by ?? null,
        updated_by: input.created_by ?? null,
    }
    const { data, error } = await (supabase as any)
        .from('roadtour_runs')
        .insert(payload)
        .select('*')
        .single()
    if (error) throw error
    return data as RoadtourRun
}
