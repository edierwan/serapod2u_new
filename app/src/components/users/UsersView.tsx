'use client'

import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Loader2 } from 'lucide-react'
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
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 text-blue-600 animate-spin" /></div>
  }

  if (!userProfile) {
    return <div className="text-center py-12"><p className="text-gray-600">User profile not found</p></div>
  }

  return <UserManagementNew userProfile={userProfile} />
}
