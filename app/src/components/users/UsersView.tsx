'use client'

import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { SeraLoadingState } from '@/components/ui/SeraLoader'
import UserManagementNew from './UserManagementNew'

interface UserProfile {
  id: string
  email: string
  role_code: string
  organization_id: string
  is_active: boolean
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

interface UsersViewProps {
  userProfile: UserProfile
}

export default function UsersView({ userProfile }: UsersViewProps) {
  const { isReady } = useSupabaseAuth()

  if (!isReady) {
    return <SeraLoadingState variant="page" label="Loading users" />
  }

  if (!userProfile) {
    return <div className="text-center py-12"><p className="text-gray-600">User profile not found</p></div>
  }

  return <UserManagementNew userProfile={userProfile} />
}
