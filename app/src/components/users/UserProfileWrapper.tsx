'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import MyProfileViewNew from '@/components/dashboard/views/MyProfileViewNew'
import { Loader2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface UserProfileWrapperProps {
  targetUserId: string
  currentUserProfile: any
  onBack?: () => void
}

export default function UserProfileWrapper({ targetUserId, currentUserProfile, onBack }: UserProfileWrapperProps) {
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  useEffect(() => {
     async function load() {
       try {
         const supabase = createClient()
         // Fetch user with joined tables
         const { data, error } = await supabase
           .from('users')
           .select(`
             *, 
             organizations:organization_id (
               id,
               org_name,
               org_type_code,
               org_code
             ), 
             roles:role_code (
               role_name,
               role_level
             )
           `)
           .eq('id', targetUserId)
           .single()
         
         if (error) throw error

         if (data) {
           // Transform to match UserProfile interface expected by MyProfileViewNew
           const transformed = {
             ...data,
             organizations: Array.isArray(data.organizations) ? data.organizations[0] : data.organizations,
             roles: Array.isArray(data.roles) ? data.roles[0] : data.roles
           }
           setProfile(transformed)
         } else {
             setError('User not found')
         }
       } catch (err: any) {
         console.error('Error loading user profile:', err)
         setError(err.message || 'Failed to load user')
       } finally {
         setLoading(false)
       }
     }

     if (targetUserId === currentUserProfile.id) {
        setProfile(currentUserProfile)
        setLoading(false)
     } else {
        load()
     }
  }, [targetUserId, currentUserProfile])

  if (loading) {
      return (
          <div className="flex h-96 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2 text-muted-foreground">Loading profile...</span>
          </div>
      )
  }

  if (error || !profile) {
      return (
          <div className="p-8 text-center text-muted-foreground">
              {onBack && <Button variant="ghost" onClick={onBack} className="mb-4"><ArrowLeft className="mr-2 h-4 w-4"/> Back</Button>}
              <p>{error || 'User not found'}</p>
          </div>
      )
  }
  
  return (
    <div className="space-y-4">
        {onBack && (
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onBack}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <div className="text-sm text-muted-foreground">
                    Viewing profile for: <span className="font-medium text-foreground">{profile.full_name || profile.email}</span>
                </div>
            </div>
        )}
        <MyProfileViewNew userProfile={profile} key={profile.id} />
    </div>
  )
}
