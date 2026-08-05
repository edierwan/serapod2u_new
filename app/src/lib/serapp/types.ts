export type SerappUserProfile = {
  id: string
  email: string
  full_name: string | null
  role_code: string
  organization_id: string
  account_scope: string | null
  organizations: {
    id: string
    org_name: string
    org_type_code: string
    org_code: string
  }
  roles: {
    role_name: string
    role_level: number
  }
}
