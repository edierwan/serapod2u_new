import DashboardContent from '@/components/dashboard/DashboardContent'
import SmsDeliveryMonitor from '@/components/settings/SmsDeliveryMonitor'
import { getSettingsPageContext } from '@/app/settings/_lib'

export const dynamic = 'force-dynamic'

export default async function SmsActivityPage() {
  const { userProfile, canViewSettings } = await getSettingsPageContext()
  if (!canViewSettings) return <div className="p-8"><h2 className="text-xl font-semibold">Unauthorized</h2></div>
  return (
    <DashboardContent userProfile={userProfile} initialView="notifications/sms-activity">
      <div className="p-4 sm:p-6">
        <SmsDeliveryMonitor />
      </div>
    </DashboardContent>
  )
}
