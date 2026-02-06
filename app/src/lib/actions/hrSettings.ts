'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { checkPermissionForUser } from '@/lib/server/permissions'

export interface HrSettingsConfig {
    work_week?: string[]
    working_hours?: { start: string; end: string }
    holidays_region?: string
    approval_defaults?: {
        fallback_to_department_manager?: boolean
        fallback_to_management_manager?: boolean
    }
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

async function canManageSettings(userId: string, roleLevel: number | null) {
    if (roleLevel !== null && roleLevel <= 20) return true
    const [manageOrgChart, editOrgSettings] = await Promise.all([
        checkPermissionForUser(userId, 'manage_org_chart'),
        checkPermissionForUser(userId, 'edit_org_settings')
    ])
    return manageOrgChart.allowed || editOrgSettings.allowed
}

export async function getHrSettings(
    organizationId: string
): Promise<{ success: boolean; data?: HrSettingsConfig; error?: string }> {
    try {
        const supabase = (await createClient()) as any
        const { data, error } = await supabase
            .from('hr_settings')
            .select('config')
            .eq('organization_id', organizationId)
            .single()

        if (error && error.code !== 'PGRST116') {
            console.error('Error loading HR settings:', error)
            return { success: false, error: error.message }
        }

        return { success: true, data: (data?.config || {}) as HrSettingsConfig }
    } catch (error) {
        console.error('Error in getHrSettings:', error)
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
}

export async function saveHrSettings(
    organizationId: string,
    config: HrSettingsConfig
): Promise<{ success: boolean; error?: string }> {
    try {
        const supabase = (await createClient()) as any
        const ctx = await getAuthContext(supabase)
        if (!ctx.success || !ctx.data) return { success: false, error: ctx.error }

        if (!(await canManageSettings(ctx.data.id, ctx.data.role_level))) {
            return { success: false, error: 'Unauthorized' }
        }

        if (ctx.data.organization_id && ctx.data.organization_id !== organizationId) {
            return { success: false, error: 'Unauthorized' }
        }

        const { error } = await supabase
            .from('hr_settings')
            .upsert({
                organization_id: organizationId,
                config
            }, { onConflict: 'organization_id' })

        if (error) {
            console.error('Error saving HR settings:', error)
            return { success: false, error: error.message }
        }

        revalidatePath('/dashboard')
        return { success: true }
    } catch (error) {
        console.error('Error in saveHrSettings:', error)
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
}
