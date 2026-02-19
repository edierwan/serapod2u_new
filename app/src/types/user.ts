export interface User {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  role_code: string
  organization_id: string
  is_active: boolean
  is_verified: boolean
  created_at: string
  updated_at: string
  avatar_url: string | null
  last_login_at: string | null
  // Account scope
  account_scope?: 'store' | 'portal' | null
  // HR Foundation fields
  department_id?: string | null
  manager_user_id?: string | null
  position_id?: string | null
  employment_type?: string | null
  join_date?: string | null
  employment_status?: string | null
}

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
  // Hierarchy fields for org chart
  parent_department_id?: string | null
  chart_order?: number | null
}

// Department hierarchy node for org chart
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

// User org chart node for people chart
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

export interface UserFormData extends Omit<User, 'created_at' | 'updated_at' | 'last_login_at'> {
  password?: string
}

export interface Role {
  role_code: string
  role_name: string
  role_level: number
}

export interface Organization {
  id: string
  org_name: string
  org_code: string
  org_type_code?: string
}
