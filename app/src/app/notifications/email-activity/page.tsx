import DashboardContent from '@/components/dashboard/DashboardContent'
import { getSettingsPageContext } from '@/app/settings/_lib'

export const dynamic = 'force-dynamic'

export default async function EmailActivityPage() {
  const { userProfile, canViewSettings } = await getSettingsPageContext()
  if (!canViewSettings) return <div className="p-8"><h2 className="text-xl font-semibold">Unauthorized</h2></div>
  return <DashboardContent userProfile={userProfile} initialView="notifications/email-activity" />
}
