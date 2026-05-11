/**
 * Shared RoadTour Event helpers (client-side).
 * Backed by the public.roadtour_runs table introduced 2026-05-12.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type RoadtourRunStatus = 'draft' | 'active' | 'completed' | 'cancelled'
export type RoadtourDuplicatePolicy = 'per_run' | 'per_campaign' | 'per_day' | 'none'

export interface RoadtourRun {
    id: string
    org_id: string
    name: string
    description: string | null
    start_date: string
    end_date: string
    status: RoadtourRunStatus
    duplicate_policy: RoadtourDuplicatePolicy
    created_at: string
    updated_at: string
}

export const DUPLICATE_POLICY_LABEL: Record<RoadtourDuplicatePolicy, string> = {
    per_run: 'One shop once per event',
    per_campaign: 'One shop once per campaign',
    per_day: 'One shop once per day',
    none: 'No duplicate restriction',
}

export const DUPLICATE_POLICY_OPTIONS: Array<{
    value: RoadtourDuplicatePolicy
    label: string
    description: string
    recommended?: boolean
}> = [
    {
        value: 'per_run',
        label: 'One shop once per event',
        description: 'Each shop can be rewarded only once per RoadTour Event regardless of campaign/reference.',
        recommended: true,
    },
    {
        value: 'per_campaign',
        label: 'One shop once per campaign',
        description: 'Legacy behaviour. Same shop can be rewarded by different campaigns in the same event.',
    },
    {
        value: 'per_day',
        label: 'One shop once per day',
        description: 'Each shop can be rewarded once per calendar day within the event.',
    },
    {
        value: 'none',
        label: 'No duplicate restriction',
        description: 'No automatic block. Use only for special diagnostic runs.',
    },
]

export const STATUS_LABEL: Record<RoadtourRunStatus, string> = {
    draft: 'Draft',
    active: 'Active',
    completed: 'Completed',
    cancelled: 'Cancelled',
}

export async function fetchRoadtourRuns(
    supabase: SupabaseClient,
    orgId: string,
): Promise<RoadtourRun[]> {
    const { data, error } = await (supabase as any)
        .from('roadtour_runs')
        .select('id, org_id, name, description, start_date, end_date, status, duplicate_policy, created_at, updated_at')
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
        duplicate_policy: input.duplicate_policy ?? 'per_run',
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
