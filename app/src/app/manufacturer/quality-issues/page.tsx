import { createClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import QualityIssuesView from '@/components/manufacturer/QualityIssuesView'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ManufacturerQualityIssuesPage() {
  // server side: force dynamic
  await headers()
  const supabase = await createClient()

  // Check auth
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) redirect('/login')

  // load profile
  const { data: userProfile, error: profileErr } = await supabase
    .from('users')
    .select('id, email, full_name, organization_id, role_code')
    .eq('id', user.id)
    .single()

  if (profileErr || !userProfile) redirect('/login')

  // Only allow super admin or manufacturer org users (org_type_code = 'MFG')
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('org_type_code')
    .eq('id', userProfile.organization_id)
    .single()

  const isManufacturerOrg = !!org && org.org_type_code === 'MFG'

  if (!(userProfile.role_code === 'SA' || isManufacturerOrg)) {
    return (
      <div className="p-8">
        <h2 className="text-xl font-semibold">Unauthorized</h2>
        <p>You do not have permission to view this page.</p>
      </div>
    )
  }

  // Render the client component that will fetch via API and provide interactivity
  return (
    <div className="p-6">
      <QualityIssuesView userProfile={userProfile} />
    </div>
  )
}
