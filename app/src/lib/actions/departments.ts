'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/utils'
import { checkPermissionForUser } from '@/lib/server/permissions'

// ============================================================================
// Types
// ============================================================================

export interface Department {
  id: string
  organization_id: string
  dept_code: string | null
  dept_name: string
  manager_user_id: string | null
  sort_order: number | null
  parent_department_id?: string | null
  chart_order?: number | null
  is_active: boolean
  created_at: string
  updated_at: string
  // Joined data
  manager?: {
    id: string
    full_name: string | null
    email: string
  } | null
  user_count?: number
}

export interface CreateDepartmentPayload {
  dept_code?: string | null
  dept_name: string
  manager_user_id?: string | null
  sort_order?: number | null
  parent_department_id?: string | null
  chart_order?: number | null
}

export interface UpdateDepartmentPayload {
  dept_code?: string | null
  dept_name?: string
  manager_user_id?: string | null
  sort_order?: number | null
  is_active?: boolean
  parent_department_id?: string | null
  chart_order?: number | null
}

const fetchManagersById = async (supabase: any, managerIds: string[]) => {
  const map = new Map<string, { id: string; full_name: string | null; email: string; avatar_url?: string | null; position_id?: string | null }>()
  if (!managerIds.length) return map

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, avatar_url, position_id')
    .in('id', managerIds)

  if (error) {
    console.error('Error fetching managers:', error)
    return map
  }

  ;(data || []).forEach((m: any) => {
    map.set(m.id, {
      id: m.id,
      full_name: m.full_name || null,
      email: m.email,
      avatar_url: m.avatar_url ?? null,
      position_id: m.position_id ?? null
    })
  })

  return map
}

// ============================================================================
// List Departments
// ============================================================================

export async function listDepartments(
  organizationId: string,
  includeDisabled: boolean = false
): Promise<{ success: boolean; data?: Department[]; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    let query = supabase
      .from('departments')
      .select(`
        *
      `)
      .eq('organization_id', organizationId)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('dept_name', { ascending: true })

    if (!includeDisabled) {
      query = query.eq('is_active', true)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error listing departments:', error)
      return { success: false, error: error.message }
    }

    // Get user counts for each department
    const deptIds = (data || []).map((d: any) => d.id)

    if (deptIds.length > 0) {
      const { data: userCounts, error: countError } = await supabase
        .from('users')
        .select('department_id')
        .in('department_id', deptIds)
        .eq('is_active', true)

      if (!countError && userCounts) {
        const countMap = userCounts.reduce((acc: Record<string, number>, u: any) => {
          acc[u.department_id] = (acc[u.department_id] || 0) + 1
          return acc
        }, {})

        // Attach counts to departments
        data?.forEach((dept: any) => {
          dept.user_count = countMap[dept.id] || 0
        })
      }
    }

    const managerIds = (data || []).map((d: any) => d.manager_user_id).filter(Boolean) as string[]
    const managerMap = await fetchManagersById(supabase, managerIds)

    return {
      success: true,
      data: (data || []).map((d: any) => ({
        ...d,
        manager: d.manager_user_id ? managerMap.get(d.manager_user_id) || null : null
      })) as Department[]
    }
  } catch (error) {
    console.error('Error in listDepartments:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============================================================================
// Create Department
// ============================================================================

export async function createDepartment(
  organizationId: string,
  payload: CreateDepartmentPayload
): Promise<{ success: boolean; data?: Department; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    // Validate required fields
    if (!payload.dept_name?.trim()) {
      return { success: false, error: 'Department name is required' }
    }

    // Check for duplicate dept_code if provided
    if (payload.dept_code) {
      const { data: existing } = await supabase
        .from('departments')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('dept_code', payload.dept_code.toUpperCase())
        .single()

      if (existing) {
        return { success: false, error: `Department code "${payload.dept_code}" already exists` }
      }
    }

    // Validate manager belongs to same organization
    if (payload.manager_user_id) {
      const { data: manager, error: managerError } = await supabase
        .from('users')
        .select('id, organization_id')
        .eq('id', payload.manager_user_id)
        .single()

      if (managerError || !manager) {
        return { success: false, error: 'Invalid manager selected' }
      }

      if (manager.organization_id !== organizationId) {
        return { success: false, error: 'Manager must belong to the same organization' }
      }
    }

    // Validate parent department if provided
    if (payload.parent_department_id) {
      const { data: parentDept, error: parentError } = await supabase
        .from('departments')
        .select('id, organization_id')
        .eq('id', payload.parent_department_id)
        .single()

      if (parentError || !parentDept) {
        return { success: false, error: 'Parent department not found' }
      }

      if (parentDept.organization_id !== organizationId) {
        return { success: false, error: 'Parent department must belong to the same organization' }
      }
    }

    const { data, error } = await supabase
      .from('departments')
      .insert({
        organization_id: organizationId,
        dept_code: payload.dept_code?.toUpperCase() || null,
        dept_name: payload.dept_name.trim(),
        manager_user_id: payload.manager_user_id || null,
        sort_order: payload.sort_order ?? 0,
        chart_order: payload.chart_order ?? null,
        parent_department_id: payload.parent_department_id || null,
        is_active: true
      })
      .select(`
        *
      `)
      .single()

    if (error) {
      console.error('Error creating department:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    const managerMap = await fetchManagersById(
      supabase,
      data?.manager_user_id ? [data.manager_user_id] : []
    )
    return {
      success: true,
      data: {
        ...data,
        manager: data?.manager_user_id ? managerMap.get(data.manager_user_id) || null : null,
        user_count: 0
      } as Department
    }
  } catch (error) {
    console.error('Error in createDepartment:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============================================================================
// Update Department
// ============================================================================

export async function updateDepartment(
  departmentId: string,
  payload: UpdateDepartmentPayload
): Promise<{ success: boolean; data?: Department; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    // Get current department to verify org
    const { data: current, error: currentError } = await supabase
      .from('departments')
      .select('organization_id')
      .eq('id', departmentId)
      .single()

    if (currentError || !current) {
      return { success: false, error: 'Department not found' }
    }

    // Validate manager belongs to same organization
    if (payload.manager_user_id) {
      const { data: manager } = await supabase
        .from('users')
        .select('id, organization_id')
        .eq('id', payload.manager_user_id)
        .single()

      if (manager && manager.organization_id !== current.organization_id) {
        return { success: false, error: 'Manager must belong to the same organization' }
      }
    }

    // Check for duplicate dept_code if changing
    if (payload.dept_code) {
      const { data: existing } = await supabase
        .from('departments')
        .select('id')
        .eq('organization_id', current.organization_id)
        .eq('dept_code', payload.dept_code.toUpperCase())
        .neq('id', departmentId)
        .single()

      if (existing) {
        return { success: false, error: `Department code "${payload.dept_code}" already exists` }
      }
    }

    // Validate parent_department_id if provided
    if (payload.parent_department_id !== undefined && payload.parent_department_id !== null) {
      // Cannot be its own parent
      if (payload.parent_department_id === departmentId) {
        return { success: false, error: 'A department cannot be its own parent' }
      }

      // Validate parent exists and is in same org
      const { data: parentDept, error: parentError } = await supabase
        .from('departments')
        .select('id, organization_id, parent_department_id')
        .eq('id', payload.parent_department_id)
        .single()

      if (parentError || !parentDept) {
        return { success: false, error: 'Parent department not found' }
      }

      if (parentDept.organization_id !== current.organization_id) {
        return { success: false, error: 'Parent department must belong to the same organization' }
      }

      // Check for circular reference - walk up the parent chain
      let currentParent = payload.parent_department_id
      let depth = 0
      const maxDepth = 10

      while (currentParent && depth < maxDepth) {
        if (currentParent === departmentId) {
          return { success: false, error: 'Cannot set parent: would create circular reference' }
        }

        const { data: p } = await supabase
          .from('departments')
          .select('parent_department_id')
          .eq('id', currentParent)
          .single()

        currentParent = p?.parent_department_id
        depth++
      }
    }

    const updateData: Record<string, any> = {}
    if (payload.dept_name !== undefined) updateData.dept_name = payload.dept_name.trim()
    if (payload.dept_code !== undefined) updateData.dept_code = payload.dept_code?.toUpperCase() || null
    if (payload.manager_user_id !== undefined) updateData.manager_user_id = payload.manager_user_id || null
    if (payload.sort_order !== undefined) updateData.sort_order = payload.sort_order
    if (payload.is_active !== undefined) updateData.is_active = payload.is_active
    if (payload.parent_department_id !== undefined) updateData.parent_department_id = payload.parent_department_id || null
    if (payload.chart_order !== undefined) updateData.chart_order = payload.chart_order

    const { data, error } = await supabase
      .from('departments')
      .update(updateData)
      .eq('id', departmentId)
      .select(`
        *
      `)
      .single()

    if (error) {
      console.error('Error updating department:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    const managerMap = await fetchManagersById(
      supabase,
      data?.manager_user_id ? [data.manager_user_id] : []
    )
    return {
      success: true,
      data: {
        ...data,
        manager: data?.manager_user_id ? managerMap.get(data.manager_user_id) || null : null
      } as Department
    }
  } catch (error) {
    console.error('Error in updateDepartment:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============================================================================
// Set Department Active/Inactive (Soft Delete)
// ============================================================================

export async function setDepartmentActive(
  departmentId: string,
  isActive: boolean
): Promise<{ success: boolean; error?: string; userCount?: number }> {
  try {
    const supabase = (await createClient()) as any

    // If disabling, check for users in this department
    if (!isActive) {
      const { count, error: countError } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('department_id', departmentId)
        .eq('is_active', true)

      if (countError) {
        console.error('Error checking user count:', countError)
      }

      // Return user count for warning (caller decides whether to proceed)
      if (count && count > 0) {
        return {
          success: false,
          error: `This department has ${count} active user(s). Please reassign them before disabling.`,
          userCount: count
        }
      }
    }

    const { error } = await supabase
      .from('departments')
      .update({ is_active: isActive })
      .eq('id', departmentId)

    if (error) {
      console.error('Error setting department active:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    return { success: true }
  } catch (error) {
    console.error('Error in setDepartmentActive:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============================================================================
// Assign User to Department
// ============================================================================

export async function assignUserDepartment(
  userId: string,
  departmentId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    // Validate department belongs to user's organization
    if (departmentId) {
      const { data: user } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', userId)
        .single()

      const { data: dept } = await supabase
        .from('departments')
        .select('organization_id, is_active')
        .eq('id', departmentId)
        .single()

      if (!dept) {
        return { success: false, error: 'Department not found' }
      }

      if (user && dept.organization_id !== user.organization_id) {
        return { success: false, error: 'Department must belong to user\'s organization' }
      }

      if (!dept.is_active) {
        return { success: false, error: 'Cannot assign to disabled department' }
      }
    }

    const { error } = await supabase
      .from('users')
      .update({ department_id: departmentId })
      .eq('id', userId)

    if (error) {
      console.error('Error assigning department:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    return { success: true }
  } catch (error) {
    console.error('Error in assignUserDepartment:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============================================================================
// Assign User Manager (Reports To)
// ============================================================================

export async function assignUserManager(
  userId: string,
  managerUserId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    // Prevent self-assignment
    if (managerUserId && managerUserId === userId) {
      return { success: false, error: 'User cannot be their own manager' }
    }

    // Validate manager belongs to same organization
    if (managerUserId) {
      const { data: user } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', userId)
        .single()

      const { data: manager } = await supabase
        .from('users')
        .select('organization_id, is_active')
        .eq('id', managerUserId)
        .single()

      if (!manager) {
        return { success: false, error: 'Manager not found' }
      }

      if (user && manager.organization_id !== user.organization_id) {
        return { success: false, error: 'Manager must belong to same organization' }
      }

      if (!manager.is_active) {
        return { success: false, error: 'Cannot assign inactive user as manager' }
      }
    }

    const { error } = await supabase
      .from('users')
      .update({ manager_user_id: managerUserId })
      .eq('id', userId)

    if (error) {
      console.error('Error assigning manager:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    return { success: true }
  } catch (error) {
    console.error('Error in assignUserManager:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============================================================================
// Get Next Approver (calls the DB function)
// ============================================================================

export interface ApproverInfo {
  approver_user_id: string
  approver_type: 'direct_manager' | 'department_manager' | 'org_admin_fallback' | 'super_admin_fallback'
  approver_name: string | null
  approver_email: string
}

export interface DepartmentMember {
  id: string
  full_name: string | null
  email: string
  phone: string | null
  role_code: string
  role_name?: string | null
  role_level?: number | null
  is_active: boolean | null
  department_id?: string | null
  manager_user_id?: string | null
  manager?: {
    id: string
    full_name: string | null
    email: string
  } | null
}

export interface RoleOption {
  role_code: string
  role_name: string
  role_level: number
}

interface UserContext {
  id: string
  organization_id: string | null
  role_code: string
  role_level: number | null
}

const HR_ROLE_CODES = new Set(['HR_MANAGER'])

const generateTempPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  let pwd = ''
  for (let i = 0; i < 12; i += 1) {
    pwd += chars[Math.floor(Math.random() * chars.length)]
  }
  return pwd
}

const canManageDepartments = (ctx: UserContext) => {
  if (!ctx) return false
  if (ctx.role_level !== null && ctx.role_level <= 20) return true
  return HR_ROLE_CODES.has(ctx.role_code)
}

const canManageOrgChart = async (ctx: UserContext) => {
  if (!ctx) return false
  if (ctx.role_level !== null && ctx.role_level <= 20) return true

  const [manageOrgChart, editOrgSettings] = await Promise.all([
    checkPermissionForUser(ctx.id, 'manage_org_chart'),
    checkPermissionForUser(ctx.id, 'edit_org_settings')
  ])

  return manageOrgChart.allowed || editOrgSettings.allowed
}

const getUserContext = async (supabase: any): Promise<{ success: boolean; data?: UserContext; error?: string }> => {
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData?.user?.id) {
    return { success: false, error: 'Not authenticated' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('id, organization_id, role_code, roles(role_level)')
    .eq('id', authData.user.id)
    .single()

  if (profileError || !profile) {
    return { success: false, error: 'Failed to load user profile' }
  }

  return {
    success: true,
    data: {
      id: profile.id,
      organization_id: profile.organization_id || null,
      role_code: profile.role_code,
      role_level: (profile.roles as any)?.role_level ?? null
    }
  }
}

export async function getNextApprover(
  userId: string
): Promise<{ success: boolean; data?: ApproverInfo; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    const { data, error } = await supabase
      .rpc('get_next_approver', { p_user_id: userId })
      .single()

    if (error) {
      console.error('Error getting next approver:', error)
      return { success: false, error: error.message }
    }

    if (!data) {
      return { success: false, error: 'No approver found' }
    }

    return { success: true, data: data as ApproverInfo }
  } catch (error) {
    console.error('Error in getNextApprover:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============================================================================
// Department Members Management
// ============================================================================

export async function getDepartmentMembers(
  departmentId: string
): Promise<{ success: boolean; data?: DepartmentMember[]; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    const ctxResult = await getUserContext(supabase)
    if (!ctxResult.success || !ctxResult.data) {
      return { success: false, error: ctxResult.error || 'Unauthorized' }
    }

    if (!(await canManageOrgChart(ctxResult.data))) {
      return { success: false, error: 'Unauthorized' }
    }

    const { data: dept, error: deptError } = await supabase
      .from('departments')
      .select('id, organization_id')
      .eq('id', departmentId)
      .single()

    if (deptError || !dept) {
      return { success: false, error: 'Department not found' }
    }

    if (ctxResult.data.organization_id && dept.organization_id !== ctxResult.data.organization_id) {
      return { success: false, error: 'Unauthorized' }
    }

    const { data, error } = await supabase
      .from('users')
      .select(
        `id, full_name, email, phone, role_code, is_active, department_id, manager_user_id,
        manager:manager_user_id!users_manager_user_id_fkey (id, full_name, email),
         roles(role_name, role_level)`
      )
      .eq('department_id', departmentId)
      .order('full_name', { ascending: true })

    if (error) {
      console.error('Error fetching department members:', error)
      return { success: false, error: error.message }
    }

    const members = (data || []).map((u: any) => ({
      ...u,
      role_name: u.roles?.role_name || null,
      role_level: u.roles?.role_level ?? null,
      manager: Array.isArray(u.manager) ? u.manager[0] : u.manager
    })) as DepartmentMember[]

    return { success: true, data: members }
  } catch (error) {
    console.error('Error in getDepartmentMembers:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function getOrgUsersForDepartmentManagement(
  organizationId: string
): Promise<{ success: boolean; data?: DepartmentMember[]; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    const ctxResult = await getUserContext(supabase)
    if (!ctxResult.success || !ctxResult.data) {
      return { success: false, error: ctxResult.error || 'Unauthorized' }
    }

    if (!canManageDepartments(ctxResult.data)) {
      return { success: false, error: 'Unauthorized' }
    }

    if (ctxResult.data.organization_id && ctxResult.data.organization_id !== organizationId) {
      return { success: false, error: 'Unauthorized' }
    }

    const { data, error } = await supabase
      .from('users')
      .select(
        `id, full_name, email, phone, role_code, is_active, department_id, manager_user_id,
        manager:manager_user_id!users_manager_user_id_fkey (id, full_name, email),
         roles(role_name, role_level)`
      )
      .eq('organization_id', organizationId)
      .order('full_name', { ascending: true })

    if (error) {
      console.error('Error fetching org users:', error)
      return { success: false, error: error.message }
    }

    const users = (data || []).map((u: any) => ({
      ...u,
      role_name: u.roles?.role_name || null,
      role_level: u.roles?.role_level ?? null,
      manager: Array.isArray(u.manager) ? u.manager[0] : u.manager
    })) as DepartmentMember[]

    return { success: true, data: users }
  } catch (error) {
    console.error('Error in getOrgUsersForDepartmentManagement:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function getRolesForDepartmentManagement(): Promise<{ success: boolean; data?: RoleOption[]; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    const { data, error } = await supabase
      .from('roles')
      .select('role_code, role_name, role_level')
      .eq('is_active', true)
      .order('role_level', { ascending: true })

    if (error) {
      console.error('Error fetching roles:', error)
      return { success: false, error: error.message }
    }

    return { success: true, data: (data || []) as RoleOption[] }
  } catch (error) {
    console.error('Error in getRolesForDepartmentManagement:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function bulkAssignUsersToDepartment(
  departmentId: string,
  userIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    if (userIds.length === 0) {
      return { success: false, error: 'No users selected' }
    }

    const supabase = (await createClient()) as any

    const ctxResult = await getUserContext(supabase)
    if (!ctxResult.success || !ctxResult.data) {
      return { success: false, error: ctxResult.error || 'Unauthorized' }
    }

    if (!canManageDepartments(ctxResult.data)) {
      return { success: false, error: 'Unauthorized' }
    }

    const { data: dept, error: deptError } = await supabase
      .from('departments')
      .select('id, organization_id')
      .eq('id', departmentId)
      .single()

    if (deptError || !dept) {
      return { success: false, error: 'Department not found' }
    }

    if (ctxResult.data.organization_id && dept.organization_id !== ctxResult.data.organization_id) {
      return { success: false, error: 'Unauthorized' }
    }

    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, organization_id')
      .in('id', userIds)

    if (usersError) {
      return { success: false, error: usersError.message }
    }

    const invalidUsers = (users || []).filter((u: any) => u.organization_id !== dept.organization_id)
    if (invalidUsers.length > 0 || (users || []).length !== userIds.length) {
      return { success: false, error: 'One or more users are not in this organization' }
    }

    const { error } = await supabase
      .from('users')
      .update({ department_id: departmentId })
      .in('id', userIds)
      .eq('organization_id', dept.organization_id)

    if (error) {
      console.error('Error assigning users to department:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    return { success: true }
  } catch (error) {
    console.error('Error in bulkAssignUsersToDepartment:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function bulkMoveUsersToDepartment(
  fromDepartmentId: string | null,
  toDepartmentId: string,
  userIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    if (userIds.length === 0) {
      return { success: false, error: 'No users selected' }
    }

    const supabase = (await createClient()) as any

    const ctxResult = await getUserContext(supabase)
    if (!ctxResult.success || !ctxResult.data) {
      return { success: false, error: ctxResult.error || 'Unauthorized' }
    }

    if (!canManageDepartments(ctxResult.data)) {
      return { success: false, error: 'Unauthorized' }
    }

    const { data: dept, error: deptError } = await supabase
      .from('departments')
      .select('id, organization_id')
      .eq('id', toDepartmentId)
      .single()

    if (deptError || !dept) {
      return { success: false, error: 'Target department not found' }
    }

    if (ctxResult.data.organization_id && dept.organization_id !== ctxResult.data.organization_id) {
      return { success: false, error: 'Unauthorized' }
    }

    const updateQuery = supabase
      .from('users')
      .update({ department_id: toDepartmentId })
      .in('id', userIds)
      .eq('organization_id', dept.organization_id)

    if (fromDepartmentId) {
      updateQuery.eq('department_id', fromDepartmentId)
    }

    const { error } = await updateQuery

    if (error) {
      console.error('Error moving users to department:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    return { success: true }
  } catch (error) {
    console.error('Error in bulkMoveUsersToDepartment:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function bulkRemoveUsersFromDepartment(
  departmentId: string,
  userIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    if (userIds.length === 0) {
      return { success: false, error: 'No users selected' }
    }

    const supabase = (await createClient()) as any

    const ctxResult = await getUserContext(supabase)
    if (!ctxResult.success || !ctxResult.data) {
      return { success: false, error: ctxResult.error || 'Unauthorized' }
    }

    if (!canManageDepartments(ctxResult.data)) {
      return { success: false, error: 'Unauthorized' }
    }

    const { data: dept, error: deptError } = await supabase
      .from('departments')
      .select('id, organization_id')
      .eq('id', departmentId)
      .single()

    if (deptError || !dept) {
      return { success: false, error: 'Department not found' }
    }

    if (ctxResult.data.organization_id && dept.organization_id !== ctxResult.data.organization_id) {
      return { success: false, error: 'Unauthorized' }
    }

    const { error } = await supabase
      .from('users')
      .update({ department_id: null })
      .in('id', userIds)
      .eq('department_id', departmentId)
      .eq('organization_id', dept.organization_id)

    if (error) {
      console.error('Error removing users from department:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    return { success: true }
  } catch (error) {
    console.error('Error in bulkRemoveUsersFromDepartment:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function updateUserManager(
  userId: string,
  managerUserId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    const ctxResult = await getUserContext(supabase)
    if (!ctxResult.success || !ctxResult.data) {
      return { success: false, error: ctxResult.error || 'Unauthorized' }
    }

    if (!canManageDepartments(ctxResult.data)) {
      return { success: false, error: 'Unauthorized' }
    }

    if (managerUserId && managerUserId === userId) {
      return { success: false, error: 'User cannot be their own manager' }
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, organization_id')
      .eq('id', userId)
      .single()

    if (userError || !user) {
      return { success: false, error: 'User not found' }
    }

    if (ctxResult.data.organization_id && user.organization_id !== ctxResult.data.organization_id) {
      return { success: false, error: 'Unauthorized' }
    }

    if (managerUserId) {
      const { data: manager, error: managerError } = await supabase
        .from('users')
        .select('id, organization_id, is_active')
        .eq('id', managerUserId)
        .single()

      if (managerError || !manager) {
        return { success: false, error: 'Manager not found' }
      }

      if (!manager.is_active) {
        return { success: false, error: 'Cannot assign inactive user as manager' }
      }

      if (manager.organization_id !== user.organization_id) {
        return { success: false, error: 'Manager must belong to same organization' }
      }
    }

    const cycleCheck = await wouldCreateUserReportingCycle(
      supabase,
      user.organization_id,
      userId,
      managerUserId
    )

    if (cycleCheck) {
      return { success: false, error: 'Cannot set manager: would create a reporting cycle' }
    }

    const { error } = await supabase
      .from('users')
      .update({ manager_user_id: managerUserId })
      .eq('id', userId)

    if (error) {
      console.error('Error updating user manager:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    return { success: true }
  } catch (error) {
    console.error('Error in updateUserManager:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function createUserForDepartment(
  departmentId: string,
  payload: {
    email: string
    full_name: string
    phone?: string | null
    role_code: string
    manager_user_id?: string | null
  }
): Promise<{ success: boolean; userId?: string; tempPassword?: string; error?: string }> {
  try {
    const supabase = (await createClient()) as any
    const adminClient = createAdminClient()

    const ctxResult = await getUserContext(supabase)
    if (!ctxResult.success || !ctxResult.data) {
      return { success: false, error: ctxResult.error || 'Unauthorized' }
    }

    if (!canManageDepartments(ctxResult.data)) {
      return { success: false, error: 'Unauthorized' }
    }

    const { data: dept, error: deptError } = await supabase
      .from('departments')
      .select('id, organization_id')
      .eq('id', departmentId)
      .single()

    if (deptError || !dept) {
      return { success: false, error: 'Department not found' }
    }

    if (ctxResult.data.organization_id && dept.organization_id !== ctxResult.data.organization_id) {
      return { success: false, error: 'Unauthorized' }
    }

    const tempPassword = generateTempPassword()
    const phone = payload.phone ? normalizePhone(payload.phone) : undefined

    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email: payload.email,
      password: tempPassword,
      email_confirm: true,
      phone: phone,
      phone_confirm: !!phone,
      user_metadata: { full_name: payload.full_name }
    })

    if (authError || !authUser?.user?.id) {
      return { success: false, error: authError?.message || 'Failed to create user' }
    }

    const { error: syncError } = await supabase
      .rpc('sync_user_profile', {
        p_user_id: authUser.user.id,
        p_email: payload.email,
        p_role_code: payload.role_code,
        p_organization_id: dept.organization_id,
        p_full_name: payload.full_name,
        p_phone: phone
      })

    if (syncError) {
      try {
        await adminClient.auth.admin.deleteUser(authUser.user.id)
      } catch (deleteError) {
        console.error('Failed to rollback auth user:', deleteError)
      }
      return { success: false, error: syncError.message }
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({
        department_id: departmentId,
        manager_user_id: payload.manager_user_id || null
      })
      .eq('id', authUser.user.id)

    if (updateError) {
      return { success: false, error: updateError.message }
    }

    revalidatePath('/dashboard')
    return { success: true, userId: authUser.user.id, tempPassword }
  } catch (error) {
    console.error('Error in createUserForDepartment:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// ============================================================================
// Get Users for Department Manager Picker
// ============================================================================

export async function getUsersForOrgPicker(
  organizationId: string
): Promise<{ success: boolean; data?: { id: string; full_name: string | null; email: string; avatar_url?: string | null; position_name?: string | null }[]; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, avatar_url, positions:position_id (name)')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('full_name', { ascending: true })

    if (error) {
      console.error('Error fetching users for picker:', error)
      return { success: false, error: error.message }
    }

    const users = (data || []).map((u: any) => ({
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      avatar_url: u.avatar_url || null,
      position_name: u.positions?.name || null
    }))

    return { success: true, data: users }
  } catch (error) {
    console.error('Error in getUsersForOrgPicker:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============================================================================
// Department Hierarchy Types
// ============================================================================

export interface DepartmentHierarchyNode {
  id: string
  dept_code: string | null
  dept_name: string
  parent_department_id: string | null
  manager_user_id: string | null
  manager_name: string | null
  manager_email: string | null
  manager_avatar_url?: string | null
  manager_position_name?: string | null
  user_count: number
  chart_order: number | null
  sort_order: number | null
  is_active: boolean
  depth: number
  path: string[]
  children?: DepartmentHierarchyNode[]
}

export interface UserOrgChartNode {
  id: string
  full_name: string | null
  email: string
  role_code: string
  role_name: string | null
  role_level: number | null
  department_id: string | null
  department_name: string | null
  department_code: string | null
  manager_user_id: string | null
  manager_name: string | null
  is_active: boolean
  avatar_url?: string | null
  position_id?: string | null
  position_name?: string | null
  employment_type?: string | null
  join_date?: string | null
  employment_status?: string | null
  depth: number
  path: string[]
  children?: UserOrgChartNode[]
}

// ============================================================================
// Get Department Hierarchy for Org Chart
// ============================================================================

export async function getDepartmentHierarchy(
  organizationId: string,
  includeDisabled: boolean = false
): Promise<{ success: boolean; data?: DepartmentHierarchyNode[]; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    // Use the database function for efficient tree query
    const { data, error } = await supabase.rpc('get_department_hierarchy', {
      p_organization_id: organizationId
    })

    if (error) {
      console.error('Error getting department hierarchy:', error)
      // Fallback to manual query if function doesn't exist
      return await getDepartmentHierarchyFallback(organizationId, includeDisabled)
    }

    let nodes = (data || []) as DepartmentHierarchyNode[]

    if (nodes.length > 0 && !('manager_avatar_url' in nodes[0])) {
      return await getDepartmentHierarchyFallback(organizationId, includeDisabled)
    }

    if (!includeDisabled) {
      nodes = nodes.filter(n => n.is_active)
    }

    // Build tree structure from flat list
    const tree = buildDepartmentTree(nodes)

    return { success: true, data: tree }
  } catch (error) {
    console.error('Error in getDepartmentHierarchy:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Fallback function if database function doesn't exist yet
async function getDepartmentHierarchyFallback(
  organizationId: string,
  includeDisabled: boolean = false
): Promise<{ success: boolean; data?: DepartmentHierarchyNode[]; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    let query = supabase
      .from('departments')
      .select(`
        id,
        dept_code,
        dept_name,
        parent_department_id,
        manager_user_id,
        chart_order,
        sort_order,
        is_active
      `)
      .eq('organization_id', organizationId)

    if (!includeDisabled) {
      query = query.eq('is_active', true)
    }

    const { data: departments, error } = await query.order('chart_order').order('sort_order').order('dept_name')

    if (error) {
      console.error('Error fetching departments:', error)
      return { success: false, error: error.message }
    }

    // Get user counts
    const deptIds = (departments || []).map((d: any) => d.id)
    let userCounts: Record<string, number> = {}

    if (deptIds.length > 0) {
      const { data: counts } = await supabase
        .from('users')
        .select('department_id')
        .in('department_id', deptIds)
        .eq('is_active', true)

      if (counts) {
        userCounts = counts.reduce((acc: Record<string, number>, u: any) => {
          acc[u.department_id] = (acc[u.department_id] || 0) + 1
          return acc
        }, {})
      }
    }

    const managerIds = (departments || []).map((d: any) => d.manager_user_id).filter(Boolean) as string[]
    const managerMap = await fetchManagersById(supabase, managerIds)

    // Build hierarchy nodes
    const nodes: DepartmentHierarchyNode[] = (departments || []).map((d: any) => {
      const manager = d.manager_user_id ? managerMap.get(d.manager_user_id) || null : null
      return {
        id: d.id,
        dept_code: d.dept_code,
        dept_name: d.dept_name,
        parent_department_id: d.parent_department_id,
        manager_user_id: d.manager_user_id,
        manager_name: manager?.full_name || null,
        manager_email: manager?.email || null,
        manager_avatar_url: manager?.avatar_url || null,
        manager_position_name: null,
        user_count: userCounts[d.id] || 0,
        chart_order: d.chart_order,
        sort_order: d.sort_order,
        is_active: d.is_active,
        depth: 0,
        path: [d.dept_name]
      }
    })

    // Build tree structure
    const tree = buildDepartmentTree(nodes)

    return { success: true, data: tree }
  } catch (error) {
    console.error('Error in getDepartmentHierarchyFallback:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

function buildDepartmentTree(nodes: DepartmentHierarchyNode[]): DepartmentHierarchyNode[] {
  const nodeMap = new Map<string, DepartmentHierarchyNode>()
  const roots: DepartmentHierarchyNode[] = []

  // First pass: create map
  nodes.forEach(node => {
    nodeMap.set(node.id, { ...node, children: [] })
  })

  // Second pass: build tree
  nodes.forEach(node => {
    const current = nodeMap.get(node.id)!
    if (node.parent_department_id && nodeMap.has(node.parent_department_id)) {
      const parent = nodeMap.get(node.parent_department_id)!
      parent.children = parent.children || []
      parent.children.push(current)
    } else {
      roots.push(current)
    }
  })

  const sortNodes = (list: DepartmentHierarchyNode[]) => {
    list.sort((a, b) => {
      const aOrder = a.chart_order ?? Number.POSITIVE_INFINITY
      const bOrder = b.chart_order ?? Number.POSITIVE_INFINITY
      if (aOrder !== bOrder) return aOrder - bOrder
      return a.dept_name.localeCompare(b.dept_name)
    })
  }

  const assignDepth = (node: DepartmentHierarchyNode, depth: number, path: string[]) => {
    node.depth = depth
    node.path = path
    if (node.children && node.children.length > 0) {
      sortNodes(node.children)
      node.children.forEach(child => assignDepth(child, depth + 1, [...path, child.dept_name]))
    }
  }

  sortNodes(roots)
  roots.forEach(root => assignDepth(root, 0, [root.dept_name]))

  return roots
}

// ============================================================================
// Get User Org Chart (Reporting Lines)
// ============================================================================

export async function getUserOrgChart(
  organizationId: string,
  departmentId?: string | null,
  includeDisabled: boolean = false,
  useDepartmentManagerFallback: boolean = false
): Promise<{ success: boolean; data?: UserOrgChartNode[]; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    // Try database function first
    const { data, error } = await supabase.rpc('get_user_org_chart', {
      p_organization_id: organizationId,
      p_department_id: departmentId || null
    })

    if (error) {
      console.error('Error getting user org chart:', error)
      // Fallback to manual query
      return await getUserOrgChartFallback(organizationId, departmentId, includeDisabled, useDepartmentManagerFallback)
    }

    let nodes = (data || []) as UserOrgChartNode[]

    if (nodes.length > 0 && !('position_id' in nodes[0])) {
      return await getUserOrgChartFallback(organizationId, departmentId, includeDisabled, useDepartmentManagerFallback)
    }

    if (!includeDisabled) {
      nodes = nodes.filter(n => n.is_active)
    }

    // Build tree structure
    const deptManagers = useDepartmentManagerFallback
      ? await getDepartmentManagerMap(supabase, organizationId)
      : {}

    const tree = buildUserTree(nodes, { useDepartmentManagerFallback, departmentManagers: deptManagers })

    return { success: true, data: tree }
  } catch (error) {
    console.error('Error in getUserOrgChart:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function getUserOrgChartFallback(
  organizationId: string,
  departmentId?: string | null,
  includeDisabled: boolean = false,
  useDepartmentManagerFallback: boolean = false
): Promise<{ success: boolean; data?: UserOrgChartNode[]; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    let query = supabase
      .from('users')
      .select(`
        id,
        full_name,
        email,
        role_code,
        department_id,
        manager_user_id,
        is_active,
        avatar_url,
        position_id,
        employment_type,
        join_date,
        employment_status,
        roles (role_name, role_level),
        departments:department_id!users_department_id_fkey (id, dept_name, dept_code, manager_user_id),
        positions:position_id (name),
        manager:manager_user_id!users_manager_user_id_fkey (id, full_name)
      `)
      .eq('organization_id', organizationId)

    if (departmentId) {
      query = query.eq('department_id', departmentId)
    }

    if (!includeDisabled) {
      query = query.eq('is_active', true)
    }

    const { data: users, error } = await query.order('full_name')

    if (error) {
      console.error('Error fetching users:', error)
      return { success: false, error: error.message }
    }

    const nodes: UserOrgChartNode[] = (users || []).map((u: any) => {
      const dept = Array.isArray(u.departments) ? u.departments[0] : u.departments
      const manager = Array.isArray(u.manager) ? u.manager[0] : u.manager
      return {
        id: u.id,
        full_name: u.full_name,
        email: u.email,
        role_code: u.role_code,
        role_name: u.roles?.role_name || null,
        role_level: u.roles?.role_level ?? null,
        department_id: u.department_id,
        department_name: dept?.dept_name || null,
        department_code: dept?.dept_code || null,
        manager_user_id: u.manager_user_id,
        manager_name: manager?.full_name || null,
        is_active: u.is_active,
        avatar_url: u.avatar_url || null,
        position_id: u.position_id || null,
        position_name: u.positions?.name || null,
        employment_type: u.employment_type || null,
        join_date: u.join_date || null,
        employment_status: u.employment_status || null,
        depth: 0,
        path: [u.id]
      }
    })

    const deptManagers = useDepartmentManagerFallback
      ? (users || []).reduce((acc: Record<string, string | null>, u: any) => {
        const dept = Array.isArray(u.departments) ? u.departments[0] : u.departments
        if (dept?.manager_user_id) {
          acc[dept.id] = dept.manager_user_id
        }
        return acc
      }, {})
      : {}

    const tree = buildUserTree(nodes, { useDepartmentManagerFallback, departmentManagers: deptManagers })

    return { success: true, data: tree }
  } catch (error) {
    console.error('Error in getUserOrgChartFallback:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

function buildUserTree(
  nodes: UserOrgChartNode[],
  options?: { useDepartmentManagerFallback?: boolean; departmentManagers?: Record<string, string | null> }
): UserOrgChartNode[] {
  const nodeMap = new Map<string, UserOrgChartNode>()
  const roots: UserOrgChartNode[] = []
  const managerMap = new Map<string, string | null>()

  const resolveManagerId = (node: UserOrgChartNode) => {
    if (node.manager_user_id) return node.manager_user_id
    if (!options?.useDepartmentManagerFallback) return null
    const deptManagerId = options?.departmentManagers?.[node.department_id || '']
    if (!deptManagerId || deptManagerId === node.id) return null
    return deptManagerId
  }

  // First pass: create map
  nodes.forEach(node => {
    nodeMap.set(node.id, { ...node, children: [] })
    managerMap.set(node.id, resolveManagerId(node))
  })

  const breaksCycle = (startId: string) => {
    const visited = new Set<string>()
    let current = managerMap.get(startId)
    while (current) {
      if (current === startId) return true
      if (visited.has(current)) return true
      visited.add(current)
      current = managerMap.get(current) || null
    }
    return false
  }

  nodes.forEach(node => {
    if (breaksCycle(node.id)) {
      managerMap.set(node.id, null)
    }
  })

  // Second pass: build tree
  nodes.forEach(node => {
    const current = nodeMap.get(node.id)!
    const effectiveManager = managerMap.get(node.id)
    if (effectiveManager && nodeMap.has(effectiveManager)) {
      const parent = nodeMap.get(effectiveManager)!
      parent.children = parent.children || []
      parent.children.push(current)
    } else {
      roots.push(current)
    }
  })

  return roots
}

// ============================================================================
// Update Department Parent (for hierarchy)
// ============================================================================

export async function updateDepartmentParent(
  departmentId: string,
  parentDepartmentId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    const ctxResult = await getUserContext(supabase)
    if (!ctxResult.success || !ctxResult.data) {
      return { success: false, error: ctxResult.error || 'Unauthorized' }
    }

    if (!(await canManageOrgChart(ctxResult.data))) {
      return { success: false, error: 'Unauthorized' }
    }

    // Prevent self-reference
    if (parentDepartmentId === departmentId) {
      return { success: false, error: 'A department cannot be its own parent' }
    }

    // Get current department
    const { data: dept, error: deptError } = await supabase
      .from('departments')
      .select('id, organization_id')
      .eq('id', departmentId)
      .single()

    if (deptError || !dept) {
      return { success: false, error: 'Department not found' }
    }

    // Check org access
    if (ctxResult.data.organization_id && dept.organization_id !== ctxResult.data.organization_id) {
      return { success: false, error: 'Unauthorized' }
    }

    // If setting a parent, validate it's in same org and not a descendant
    if (parentDepartmentId) {
      const { data: parent, error: parentError } = await supabase
        .from('departments')
        .select('id, organization_id')
        .eq('id', parentDepartmentId)
        .single()

      if (parentError || !parent) {
        return { success: false, error: 'Parent department not found' }
      }

      if (parent.organization_id !== dept.organization_id) {
        return { success: false, error: 'Parent must be in same organization' }
      }

      // Check for circular reference - walk up the parent chain
      let currentParent = parentDepartmentId
      let depth = 0
      const maxDepth = 10

      while (currentParent && depth < maxDepth) {
        if (currentParent === departmentId) {
          return { success: false, error: 'Cannot set parent: would create circular reference' }
        }

        const { data: p } = await supabase
          .from('departments')
          .select('parent_department_id')
          .eq('id', currentParent)
          .single()

        currentParent = p?.parent_department_id
        depth++
      }
    }

    const { error } = await supabase
      .from('departments')
      .update({ parent_department_id: parentDepartmentId })
      .eq('id', departmentId)

    if (error) {
      console.error('Error updating department parent:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    return { success: true }
  } catch (error) {
    console.error('Error in updateDepartmentParent:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============================================================================
// Update Chart Order
// ============================================================================

export async function updateDepartmentChartOrder(
  departmentId: string,
  chartOrder: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    const ctxResult = await getUserContext(supabase)
    if (!ctxResult.success || !ctxResult.data) {
      return { success: false, error: ctxResult.error || 'Unauthorized' }
    }

    if (!(await canManageOrgChart(ctxResult.data))) {
      return { success: false, error: 'Unauthorized' }
    }

    const { error } = await supabase
      .from('departments')
      .update({ chart_order: chartOrder })
      .eq('id', departmentId)

    if (error) {
      console.error('Error updating chart order:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    return { success: true }
  } catch (error) {
    console.error('Error in updateDepartmentChartOrder:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============================================================================
// Update Department Chart (Parent + Order + Manager)
// ============================================================================

export async function updateDepartmentChart(
  departmentId: string,
  payload: { parent_department_id?: string | null; chart_order?: number | null; manager_user_id?: string | null }
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    const ctxResult = await getUserContext(supabase)
    if (!ctxResult.success || !ctxResult.data) {
      return { success: false, error: ctxResult.error || 'Unauthorized' }
    }

    if (!(await canManageOrgChart(ctxResult.data))) {
      return { success: false, error: 'Unauthorized' }
    }

    const { data: dept, error: deptError } = await supabase
      .from('departments')
      .select('id, organization_id')
      .eq('id', departmentId)
      .single()

    if (deptError || !dept) {
      return { success: false, error: 'Department not found' }
    }

    if (ctxResult.data.organization_id && dept.organization_id !== ctxResult.data.organization_id) {
      return { success: false, error: 'Unauthorized' }
    }

    if (payload.parent_department_id !== undefined) {
      if (payload.parent_department_id === departmentId) {
        return { success: false, error: 'A department cannot be its own parent' }
      }

      if (payload.parent_department_id) {
        const { data: parent, error: parentError } = await supabase
          .from('departments')
          .select('id, organization_id')
          .eq('id', payload.parent_department_id)
          .single()

        if (parentError || !parent) {
          return { success: false, error: 'Parent department not found' }
        }

        if (parent.organization_id !== dept.organization_id) {
          return { success: false, error: 'Parent must be in same organization' }
        }

        let currentParent = payload.parent_department_id
        let depth = 0
        const maxDepth = 20

        while (currentParent && depth < maxDepth) {
          if (currentParent === departmentId) {
            return { success: false, error: 'Cannot set parent: would create circular reference' }
          }

          const { data: p } = await supabase
            .from('departments')
            .select('parent_department_id')
            .eq('id', currentParent)
            .single()

          currentParent = p?.parent_department_id || null
          depth++
        }
      }
    }

    if (payload.manager_user_id !== undefined && payload.manager_user_id) {
      const { data: manager, error: managerError } = await supabase
        .from('users')
        .select('id, organization_id, is_active')
        .eq('id', payload.manager_user_id)
        .single()

      if (managerError || !manager) {
        return { success: false, error: 'Manager not found' }
      }

      if (!manager.is_active) {
        return { success: false, error: 'Cannot assign inactive user as manager' }
      }

      if (manager.organization_id !== dept.organization_id) {
        return { success: false, error: 'Manager must belong to same organization' }
      }
    }

    const updateData: Record<string, any> = {}
    if (payload.parent_department_id !== undefined) updateData.parent_department_id = payload.parent_department_id || null
    if (payload.chart_order !== undefined) updateData.chart_order = payload.chart_order
    if (payload.manager_user_id !== undefined) updateData.manager_user_id = payload.manager_user_id || null

    const { error } = await supabase
      .from('departments')
      .update(updateData)
      .eq('id', departmentId)

    if (error) {
      console.error('Error updating department chart:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    return { success: true }
  } catch (error) {
    console.error('Error in updateDepartmentChart:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============================================================================
// Reorder Department Within Parent
// ============================================================================

export async function reorderDepartmentWithinParent(
  departmentId: string,
  direction: 'up' | 'down'
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    const ctxResult = await getUserContext(supabase)
    if (!ctxResult.success || !ctxResult.data) {
      return { success: false, error: ctxResult.error || 'Unauthorized' }
    }

    if (!(await canManageOrgChart(ctxResult.data))) {
      return { success: false, error: 'Unauthorized' }
    }

    const { data: dept, error: deptError } = await supabase
      .from('departments')
      .select('id, organization_id, parent_department_id')
      .eq('id', departmentId)
      .single()

    if (deptError || !dept) {
      return { success: false, error: 'Department not found' }
    }

    if (ctxResult.data.organization_id && dept.organization_id !== ctxResult.data.organization_id) {
      return { success: false, error: 'Unauthorized' }
    }

    let query = supabase
      .from('departments')
      .select('id, dept_name, chart_order')
      .eq('organization_id', dept.organization_id)

    if (dept.parent_department_id) {
      query = query.eq('parent_department_id', dept.parent_department_id)
    } else {
      query = query.is('parent_department_id', null)
    }

    const { data: siblings, error: siblingsError } = await query

    if (siblingsError || !siblings) {
      return { success: false, error: 'Failed to load department order' }
    }

    const sorted = [...siblings].sort((a: any, b: any) => {
      const aOrder = a.chart_order ?? Number.POSITIVE_INFINITY
      const bOrder = b.chart_order ?? Number.POSITIVE_INFINITY
      if (aOrder !== bOrder) return aOrder - bOrder
      return a.dept_name.localeCompare(b.dept_name)
    })

    const currentIndex = sorted.findIndex((d: any) => d.id === departmentId)
    if (currentIndex < 0) {
      return { success: false, error: 'Department not found in siblings' }
    }

    const swapWith = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (swapWith < 0 || swapWith >= sorted.length) {
      return { success: false, error: 'Already at edge' }
    }

    const reordered = [...sorted]
    const temp = reordered[currentIndex]
    reordered[currentIndex] = reordered[swapWith]
    reordered[swapWith] = temp

    const updateResults = await Promise.all(
      reordered.map((d: any, index: number) =>
        supabase
          .from('departments')
          .update({ chart_order: index + 1 })
          .eq('id', d.id)
      )
    )

    const updateError = updateResults.find(r => r.error)?.error
    if (updateError) {
      console.error('Error reordering departments:', updateError)
      return { success: false, error: updateError.message }
    }

    revalidatePath('/dashboard')
    return { success: true }
  } catch (error) {
    console.error('Error in reorderDepartmentWithinParent:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// ============================================================================
// Update User Reporting Line
// ============================================================================

export async function updateUserReporting(
  userId: string,
  payload: { manager_user_id?: string | null; department_id?: string | null; position_id?: string | null }
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    const ctxResult = await getUserContext(supabase)
    if (!ctxResult.success || !ctxResult.data) {
      return { success: false, error: ctxResult.error || 'Unauthorized' }
    }

    if (!(await canManageOrgChart(ctxResult.data))) {
      return { success: false, error: 'Unauthorized' }
    }

    if (payload.manager_user_id && payload.manager_user_id === userId) {
      return { success: false, error: 'User cannot be their own manager' }
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, organization_id')
      .eq('id', userId)
      .single()

    if (userError || !user) {
      return { success: false, error: 'User not found' }
    }

    if (ctxResult.data.organization_id && user.organization_id !== ctxResult.data.organization_id) {
      return { success: false, error: 'Unauthorized' }
    }

    if (payload.manager_user_id) {
      const { data: manager, error: managerError } = await supabase
        .from('users')
        .select('id, organization_id, is_active')
        .eq('id', payload.manager_user_id)
        .single()

      if (managerError || !manager) {
        return { success: false, error: 'Manager not found' }
      }

      if (!manager.is_active) {
        return { success: false, error: 'Cannot assign inactive user as manager' }
      }

      if (manager.organization_id !== user.organization_id) {
        return { success: false, error: 'Manager must belong to same organization' }
      }
    }

    if (payload.department_id) {
      const { data: dept, error: deptError } = await supabase
        .from('departments')
        .select('id, organization_id')
        .eq('id', payload.department_id)
        .single()

      if (deptError || !dept) {
        return { success: false, error: 'Department not found' }
      }

      if (dept.organization_id !== user.organization_id) {
        return { success: false, error: 'Department must belong to same organization' }
      }
    }

    if (payload.position_id) {
      const { data: position, error: positionError } = await supabase
        .from('hr_positions')
        .select('id, organization_id')
        .eq('id', payload.position_id)
        .single()

      if (positionError || !position) {
        return { success: false, error: 'Position not found' }
      }

      if (position.organization_id !== user.organization_id) {
        return { success: false, error: 'Position must belong to same organization' }
      }
    }

    const cycleCheck = await wouldCreateUserReportingCycle(
      supabase,
      user.organization_id,
      userId,
      payload.manager_user_id ?? null
    )

    if (cycleCheck) {
      return { success: false, error: 'Cannot set manager: would create a reporting cycle' }
    }

    const updateData: Record<string, any> = {}
    if (payload.manager_user_id !== undefined) updateData.manager_user_id = payload.manager_user_id || null
    if (payload.department_id !== undefined) updateData.department_id = payload.department_id || null
    if (payload.position_id !== undefined) updateData.position_id = payload.position_id || null

    const { error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)

    if (error) {
      console.error('Error updating user reporting:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    return { success: true }
  } catch (error) {
    console.error('Error in updateUserReporting:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// ============================================================================
// Helpers
// ============================================================================

async function getDepartmentManagerMap(supabase: any, organizationId: string) {
  const { data } = await supabase
    .from('departments')
    .select('id, manager_user_id')
    .eq('organization_id', organizationId)

  const map: Record<string, string | null> = {}
  for (const dept of data || []) {
    map[dept.id] = dept.manager_user_id || null
  }
  return map
}

async function wouldCreateUserReportingCycle(
  supabase: any,
  organizationId: string,
  userId: string,
  managerUserId: string | null
) {
  if (!managerUserId) return false

  const { data, error } = await supabase
    .from('users')
    .select('id, manager_user_id')
    .eq('organization_id', organizationId)

  if (error || !data) {
    console.error('Error checking reporting cycle:', error)
    return false
  }

  const map = new Map<string, string | null>()
  for (const user of data) {
    map.set(user.id, user.manager_user_id || null)
  }

  const seen = new Set<string>()
  let current: string | null = managerUserId

  while (current) {
    if (current === userId) return true
    if (seen.has(current)) return true
    seen.add(current)
    current = map.get(current) || null
  }

  return false
}

// ============================================================================
// Get Single Department with Details
// ============================================================================

export async function getDepartmentDetails(
  departmentId: string
): Promise<{ success: boolean; data?: Department & { parent?: Department | null }; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    const { data, error } = await supabase
      .from('departments')
      .select(`
        *,
        parent:parent_department_id (
          id,
          dept_code,
          dept_name
        )
      `)
      .eq('id', departmentId)
      .single()

    if (error) {
      console.error('Error getting department details:', error)
      return { success: false, error: error.message }
    }

    // Get user count
    const { count } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('department_id', departmentId)
      .eq('is_active', true)

    const managerMap = await fetchManagersById(
      supabase,
      data?.manager_user_id ? [data.manager_user_id] : []
    )

    return {
      success: true,
      data: {
        ...data,
        manager: data?.manager_user_id ? managerMap.get(data.manager_user_id) || null : null,
        parent: Array.isArray(data.parent) ? data.parent[0] : data.parent,
        user_count: count || 0
      } as Department & { parent?: Department | null }
    }
  } catch (error) {
    console.error('Error in getDepartmentDetails:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// ============================================================================
// Get All Departments for Parent Picker (exclude self and descendants)
// ============================================================================

export async function getDepartmentsForParentPicker(
  organizationId: string,
  excludeDepartmentId?: string
): Promise<{ success: boolean; data?: { id: string; dept_code: string | null; dept_name: string }[]; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    let query = supabase
      .from('departments')
      .select('id, dept_code, dept_name, parent_department_id')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('dept_name')

    const { data, error } = await query

    if (error) {
      console.error('Error fetching departments for picker:', error)
      return { success: false, error: error.message }
    }

    let departments = data || []

    // If excluding a department, also exclude its descendants
    if (excludeDepartmentId) {
      const descendantIds = new Set<string>()
      descendantIds.add(excludeDepartmentId)

      // Find all descendants
      let foundNew = true
      while (foundNew) {
        foundNew = false
        for (const dept of departments) {
          if (dept.parent_department_id && descendantIds.has(dept.parent_department_id) && !descendantIds.has(dept.id)) {
            descendantIds.add(dept.id)
            foundNew = true
          }
        }
      }

      departments = departments.filter((d: any) => !descendantIds.has(d.id))
    }

    return {
      success: true,
      data: departments.map((d: any) => ({
        id: d.id,
        dept_code: d.dept_code,
        dept_name: d.dept_name
      }))
    }
  } catch (error) {
    console.error('Error in getDepartmentsForParentPicker:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

