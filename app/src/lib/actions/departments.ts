'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/utils'

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
}

export interface UpdateDepartmentPayload {
  dept_code?: string | null
  dept_name?: string
  manager_user_id?: string | null
  sort_order?: number | null
  is_active?: boolean
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
        *,
        manager:manager_user_id (
          id,
          full_name,
          email
        )
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

    return { 
      success: true, 
      data: (data || []).map((d: any) => ({
        ...d,
        manager: Array.isArray(d.manager) ? d.manager[0] : d.manager
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

    const { data, error } = await supabase
      .from('departments')
      .insert({
        organization_id: organizationId,
        dept_code: payload.dept_code?.toUpperCase() || null,
        dept_name: payload.dept_name.trim(),
        manager_user_id: payload.manager_user_id || null,
        sort_order: payload.sort_order ?? 0,
        is_active: true
      })
      .select(`
        *,
        manager:manager_user_id (
          id,
          full_name,
          email
        )
      `)
      .single()

    if (error) {
      console.error('Error creating department:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    return { 
      success: true, 
      data: {
        ...data,
        manager: Array.isArray(data.manager) ? data.manager[0] : data.manager,
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

    const updateData: Record<string, any> = {}
    if (payload.dept_name !== undefined) updateData.dept_name = payload.dept_name.trim()
    if (payload.dept_code !== undefined) updateData.dept_code = payload.dept_code?.toUpperCase() || null
    if (payload.manager_user_id !== undefined) updateData.manager_user_id = payload.manager_user_id || null
    if (payload.sort_order !== undefined) updateData.sort_order = payload.sort_order
    if (payload.is_active !== undefined) updateData.is_active = payload.is_active

    const { data, error } = await supabase
      .from('departments')
      .update(updateData)
      .eq('id', departmentId)
      .select(`
        *,
        manager:manager_user_id (
          id,
          full_name,
          email
        )
      `)
      .single()

    if (error) {
      console.error('Error updating department:', error)
      return { success: false, error: error.message }
    }

    revalidatePath('/dashboard')
    return { 
      success: true, 
      data: {
        ...data,
        manager: Array.isArray(data.manager) ? data.manager[0] : data.manager
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

    const { data, error } = await supabase
      .from('users')
      .select(
        `id, full_name, email, phone, role_code, is_active, department_id, manager_user_id,
         manager:manager_user_id (id, full_name, email),
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
         manager:manager_user_id (id, full_name, email),
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
): Promise<{ success: boolean; data?: { id: string; full_name: string | null; email: string }[]; error?: string }> {
  try {
    const supabase = (await createClient()) as any

    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('full_name', { ascending: true })

    if (error) {
      console.error('Error fetching users for picker:', error)
      return { success: false, error: error.message }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    console.error('Error in getUsersForOrgPicker:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}
