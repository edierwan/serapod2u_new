import DashboardContent from '@/components/dashboard/DashboardContent'
import { getSecurityAccessContext } from './_lib'

export const dynamic = 'force-dynamic'

export default async function SecurityAccessPage() {
  const { userProfile, allowed } = await getSecurityAccessContext()
  if (!allowed) return <div className="p-8"><h1 className="text-xl font-semibold">Unauthorized</h1><p className="mt-2 text-sm text-gray-600">Security & Access administration requires the Security & Access view permission (security.access.view).</p></div>
  return <DashboardContent userProfile={userProfile} initialView="security-access" />
}
