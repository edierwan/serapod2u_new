'use client'

import { createContext, useContext, type ReactNode } from 'react'

/* ─── User profile shape (matches getHrPageContext output) ────────── */

export interface HrUserProfile {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  role_code: string
  organization_id: string | null
  avatar_url: string | null
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
  department_id?: string | null
  manager_user_id?: string | null
}

/* ─── Context value ───────────────────────────────────────────────── */

interface HrMobileContextType {
  userProfile: HrUserProfile
  /** Manager-level: role_level ≤ 50 (WH_MANAGER, SHOP_MANAGER, admins) */
  isManager: boolean
  /** Admin / HR admin: role_level ≤ 30 */
  isAdmin: boolean
  organizationId: string
}

const HrMobileContext = createContext<HrMobileContextType | null>(null)

/* ─── Hook ────────────────────────────────────────────────────────── */

export function useHrMobile() {
  const ctx = useContext(HrMobileContext)
  if (!ctx) {
    throw new Error('useHrMobile must be used inside <HrMobileProvider>')
  }
  return ctx
}

/* ─── Provider ────────────────────────────────────────────────────── */

export function HrMobileProvider({
  userProfile,
  children,
}: {
  userProfile: HrUserProfile
  children: ReactNode
}) {
  const roleLevel = userProfile.roles?.role_level ?? 70
  const isAdmin = roleLevel <= 30
  const isManager = roleLevel <= 50
  const organizationId =
    userProfile.organization_id ?? userProfile.organizations?.id ?? ''

  return (
    <HrMobileContext.Provider
      value={{ userProfile, isManager, isAdmin, organizationId }}
    >
      {children}
    </HrMobileContext.Provider>
  )
}
