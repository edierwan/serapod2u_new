'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkPermissionForUser, computeEffectivePermissions, getUserPermissionContext } from '@/lib/server/permissions'

export interface DepartmentAuthorizationRecord {
    id: string
    dept_code: string | null
    dept_name: string
    permission_overrides: {
        allow: string[]
        deny: string[]
    }
    organization_id: string
    is_active: boolean
}

export interface AuthorizationUserOption {
    id: string
    full_name: string | null
    email: string
    role_code: string | null
    role_level: number | null
    department_id: string | null
    department: {
        dept_code: string | null
        dept_name: string | null
    } | null
}

const normalizeOverrides = (overrides: any) => {
    const allow = Array.isArray(overrides?.allow) ? overrides.allow.filter(Boolean) : []
    const deny = Array.isArray(overrides?.deny) ? overrides.deny.filter(Boolean) : []
    return {
        allow: Array.from(new Set(allow)),
        deny: Array.from(new Set(deny))
    }
}

const requireManageAuthorization = async (userId: string) => {
    const check = await checkPermissionForUser(userId, 'manage_authorization')
    if (!check.allowed) {
        throw new Error('Forbidden')
    }
    return check.context
}

export async function getAuthorizationDepartments() {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return { success: false, error: 'Unauthorized' }
        }

        const ctx = await requireManageAuthorization(user.id)
        if (!ctx?.organization_id) {
            return { success: false, error: 'Organization not found' }
        }

        const adminClient = createAdminClient() as any
        const { data, error } = await adminClient
            .from('departments')
            .select('id, dept_code, dept_name, permission_overrides, organization_id, is_active, sort_order')
            .eq('organization_id', ctx.organization_id)
            .order('sort_order', { ascending: true })

        if (error) {
            return { success: false, error: error.message }
        }

        const mapped = (data || []).map((dept: any) => ({
            id: dept.id,
            dept_code: dept.dept_code,
            dept_name: dept.dept_name,
            permission_overrides: normalizeOverrides(dept.permission_overrides),
            organization_id: dept.organization_id,
            is_active: dept.is_active
        })) as DepartmentAuthorizationRecord[]

        return { success: true, data: mapped }
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
}

export async function updateDepartmentPermissionOverrides(departmentId: string, overrides: { allow: string[]; deny: string[] }) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return { success: false, error: 'Unauthorized' }
        }

        const ctx = await requireManageAuthorization(user.id)
        if (!ctx?.organization_id) {
            return { success: false, error: 'Organization not found' }
        }

        const adminClient = createAdminClient() as any
        const { data: department, error: deptError } = await adminClient
            .from('departments')
            .select('id, organization_id')
            .eq('id', departmentId)
            .single()

        if (deptError || !department) {
            return { success: false, error: 'Department not found' }
        }

        if (ctx.role_level !== 1 && department.organization_id !== ctx.organization_id) {
            return { success: false, error: 'Forbidden' }
        }

        const sanitized = normalizeOverrides(overrides)

        const { error: updateError } = await adminClient
            .from('departments')
            .update({ permission_overrides: sanitized })
            .eq('id', departmentId)

        if (updateError) {
            return { success: false, error: updateError.message }
        }

        return { success: true }
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
}

export async function resetDepartmentPermissionOverrides(departmentId: string) {
    return updateDepartmentPermissionOverrides(departmentId, { allow: [], deny: [] })
}

export async function saveRolePermissions(updates: { roleId: string; permissions: Record<string, boolean> }[]) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return { success: false, error: 'Unauthorized' }
        }

        await requireManageAuthorization(user.id)

        const adminClient = createAdminClient() as any
        for (const update of updates) {
            const { error } = await adminClient
                .from('roles')
                .update({ permissions: update.permissions })
                .eq('id', update.roleId)

            if (error) {
                return { success: false, error: error.message }
            }
        }

        return { success: true }
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
}

export async function searchAuthorizationUsers(query: string) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return { success: false, error: 'Unauthorized' }
        }

        const ctx = await requireManageAuthorization(user.id)
        if (!ctx?.organization_id) {
            return { success: false, error: 'Organization not found' }
        }

        const adminClient = createAdminClient() as any
        const search = query?.trim()

        let request = adminClient
            .from('users')
            .select('id, full_name, email, role_code, department_id, roles(role_level), departments:department_id!users_department_id_fkey(dept_code, dept_name)')
            .eq('organization_id', ctx.organization_id)
            .limit(20)

        if (search) {
            request = request.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`)
        }

        const { data, error } = await request

        if (error) {
            return { success: false, error: error.message }
        }

        const mapped = (data || []).map((u: any) => ({
            id: u.id,
            full_name: u.full_name,
            email: u.email,
            role_code: u.role_code,
            role_level: (u.roles as any)?.role_level ?? null,
            department_id: u.department_id ?? null,
            department: Array.isArray(u.departments) ? u.departments[0] : u.departments
        })) as AuthorizationUserOption[]

        return { success: true, data: mapped }
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
}

export async function testPermissionAccess(userId: string, permissionKey: string) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return { success: false, error: 'Unauthorized' }
        }

        await requireManageAuthorization(user.id)

        const evaluation = await computeEffectivePermissions(userId)
        if (!evaluation.context) {
            return { success: false, error: 'User not found' }
        }

        const allowed = evaluation.allowed.has(permissionKey)
        const reason = evaluation.explain(permissionKey)

        return {
            success: true,
            data: {
                allowed,
                reason,
                allowedCount: evaluation.allowed.size,
                deniedCount: evaluation.denied.size,
                context: evaluation.context
            }
        }
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
}
