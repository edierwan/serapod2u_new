'use client'

import { useEffect, useState } from 'react'
import { EngagementShell } from '@/components/engagement/EngagementShell'
import ProductCatalogView from '@/components/dashboard/views/consumer-engagement/ProductCatalogView'
import { createClient } from '@/lib/supabase/client'

export default function ProductCatalogPage() {
  const [userProfile, setUserProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadUserProfile() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        const { data } = await supabase
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
          .eq('id', user.id)
          .single()

        if (data) {
          setUserProfile({
            ...data,
            organizations: Array.isArray(data.organizations) ? data.organizations[0] : data.organizations,
            roles: Array.isArray(data.roles) ? data.roles[0] : data.roles
          })
        }
      }
      setLoading(false)
    }

    loadUserProfile()
  }, [])

  if (loading || !userProfile) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>
  }

  return (
    <EngagementShell userProfile={userProfile} activeView="product-catalog">
      <ProductCatalogView userProfile={userProfile} onViewChange={() => {}} />
    </EngagementShell>
  )
}

