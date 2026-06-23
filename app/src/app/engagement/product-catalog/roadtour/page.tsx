'use client'

import { Suspense, useEffect, useState } from 'react'
import { EngagementShell } from '@/components/engagement/EngagementShell'
import RoadtourCatalogView from '@/components/product-catalog/roadtour/RoadtourCatalogView'
import { createClient } from '@/lib/supabase/client'

/**
 * /engagement/product-catalog/roadtour — RoadTour Product Catalog admin.
 *
 * Sibling of the Storefront Product Catalog. Lets an admin control which
 * Product Master products appear on the Ellbow RoadTour mobile Product page.
 * The existing Storefront catalog route is unchanged.
 */
export default function RoadtourProductCatalogPage() {
  const [userProfile, setUserProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadUserProfile() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data } = await supabase
          .from('users')
          .select(`*, organizations:organization_id ( id, org_name, org_type_code, org_code ), roles:role_code ( role_name, role_level )`)
          .eq('id', user.id)
          .single()
        if (data) {
          setUserProfile({
            ...data,
            organizations: Array.isArray(data.organizations) ? data.organizations[0] : data.organizations,
            roles: Array.isArray(data.roles) ? data.roles[0] : data.roles,
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
      <Suspense fallback={<div className="p-8">Loading…</div>}>
        <RoadtourCatalogView />
      </Suspense>
    </EngagementShell>
  )
}
