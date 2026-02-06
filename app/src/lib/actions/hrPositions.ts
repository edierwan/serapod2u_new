'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { checkPermissionForUser } from '@/lib/server/permissions'

export interface HrPosition {
    id: string
    organization_id: string
    code: string
    name: string
    level: number | null
    category?: string | null
    is_active: boolean
    created_at: string
    updated_at: string
    user_count?: number
}

async function getAuthContext(supabase: any) {
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData?.user?.id) {
        return { success: false, error: 'Not authenticated' }
    }

    const { data: profile, error: profileError } = await supabase
        .from('users')
        .select('id, organization_id, roles(role_level)')
        .eq('id', authData.user.id)
        .single()

    if (profileError || !profile) {
        return { success: false, error: 'Failed to load user profile' }
    }

    return {
        success: true,
        data: {
            id: profile.id,
            organization_id: profile.organization_id as string | null,
            role_level: (profile.roles as any)?.role_level ?? null
        }
    }
}

async function canManagePositions(userId: string, roleLevel: number | null) {
    if (roleLevel !== null && roleLevel <= 20) return true
    const [manageOrgChart, editOrgSettings] = await Promise.all([
        checkPermissionForUser(userId, 'manage_org_chart'),
        checkPermissionForUser(userId, 'edit_org_settings')
    ])
    return manageOrgChart.allowed || editOrgSettings.allowed
}

export async function listPositions(
    organizationId: string,
    includeDisabled = false
): Promise<{ success: boolean; data?: HrPosition[]; error?: string }> {
    try {
        const supabase = (await createClient()) as any

        let query = supabase
            .from('hr_positions')
            .select('*')
            .eq('organization_id', organizationId)
            .order('level', { ascending: true, nullsFirst: false })
            .order('name', { ascending: true })

        if (!includeDisabled) {
            query = query.eq('is_active', true)
        }

        const { data, error } = await query
        if (error) {
            console.error('Error listing positions:', error)
            return { success: false, error: error.message }
        }

        const positionIds = (data || []).map((p: any) => p.id)
        let counts: Record<string, number> = {}

        if (positionIds.length > 0) {
            const { data: users } = await supabase
                .from('users')
                .select('position_id')
                .in('position_id', positionIds)
                .eq('is_active', true)

            if (users) {
                counts = users.reduce((acc: Record<string, number>, u: any) => {
                    if (!u.position_id) return acc
                    acc[u.position_id] = (acc[u.position_id] || 0) + 1
                    return acc
                }, {})
            }
        }

        const positions = (data || []).map((p: any) => ({
            ...p,
            user_count: counts[p.id] || 0
        })) as HrPosition[]

        return { success: true, data: positions }
    } catch (error) {
        console.error('Error in listPositions:', error)
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
}

export async function getPositionsForPicker(
    organizationId: string
): Promise<{ success: boolean; data?: HrPosition[]; error?: string }> {
    return listPositions(organizationId, true)
}

export async function createPosition(
    organizationId: string,
    payload: { code: string; name: string; level?: number | null; category?: string | null }
): Promise<{ success: boolean; data?: HrPosition; error?: string }> {
    try {
        const supabase = (await createClient()) as any
        const ctx = await getAuthContext(supabase)
        if (!ctx.success || !ctx.data) return { success: false, error: ctx.error }

        if (!(await canManagePositions(ctx.data.id, ctx.data.role_level))) {
            return { success: false, error: 'Unauthorized' }
        }

        if (ctx.data.organization_id && ctx.data.organization_id !== organizationId) {
            return { success: false, error: 'Unauthorized' }
        }

        if (!payload.code?.trim() || !payload.name?.trim()) {
            return { success: false, error: 'Code and name are required' }
        }

        const { data, error } = await supabase
            .from('hr_positions')
            .insert({
                organization_id: organizationId,
                code: payload.code.trim().toUpperCase(),
                name: payload.name.trim(),
                level: payload.level ?? null,
                category: payload.category ?? null,
                is_active: true
            })
            .select('*')
            .single()

        if (error) {
            console.error('Error creating position:', error)
            return { success: false, error: error.message }
        }

        revalidatePath('/dashboard')
        return { success: true, data: data as HrPosition }
    } catch (error) {
        console.error('Error in createPosition:', error)
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
}

export async function updatePosition(
    positionId: string,
    payload: { name?: string; level?: number | null; category?: string | null; is_active?: boolean }
): Promise<{ success: boolean; data?: HrPosition; error?: string }> {
    try {
        const supabase = (await createClient()) as any
        const ctx = await getAuthContext(supabase)
        if (!ctx.success || !ctx.data) return { success: false, error: ctx.error }

        if (!(await canManagePositions(ctx.data.id, ctx.data.role_level))) {
            return { success: false, error: 'Unauthorized' }
        }

        const { data: current, error: currentError } = await supabase
            .from('hr_positions')
            .select('id, organization_id')
            .eq('id', positionId)
            .single()

        if (currentError || !current) {
            return { success: false, error: 'Position not found' }
        }

        if (ctx.data.organization_id && ctx.data.organization_id !== current.organization_id) {
            return { success: false, error: 'Unauthorized' }
        }

        const updateData: Record<string, any> = {}
        if (payload.name !== undefined) updateData.name = payload.name.trim()
        if (payload.level !== undefined) updateData.level = payload.level
        if (payload.category !== undefined) updateData.category = payload.category
        if (payload.is_active !== undefined) updateData.is_active = payload.is_active

        const { data, error } = await supabase
            .from('hr_positions')
            .update(updateData)
            .eq('id', positionId)
            .select('*')
            .single()

        if (error) {
            console.error('Error updating position:', error)
            return { success: false, error: error.message }
        }

        revalidatePath('/dashboard')
        return { success: true, data: data as HrPosition }
    } catch (error) {
        console.error('Error in updatePosition:', error)
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
}

export async function togglePositionStatus(
    positionId: string,
    isActive: boolean
): Promise<{ success: boolean; error?: string }> {
    const result = await updatePosition(positionId, { is_active: isActive })
    return { success: result.success, error: result.error }
}
