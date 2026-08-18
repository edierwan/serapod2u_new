import DashboardContent from '@/components/dashboard/DashboardContent'
import { getSettingsPageContext } from '@/app/settings/_lib'
import { ensureNotificationTypes } from '@/lib/notifications/ensureNotificationTypes'

export default async function SettingsNotificationTypesPage() {
    await ensureNotificationTypes()
    const { userProfile, canViewSettings } = await getSettingsPageContext()
    if (!canViewSettings) return <div className="p-8"><h2 className="text-xl font-semibold">Unauthorized</h2></div>
    return <DashboardContent userProfile={userProfile} initialView="settings/notifications/types" />
}
