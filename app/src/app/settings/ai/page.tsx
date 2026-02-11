import DashboardContent from '@/components/dashboard/DashboardContent'
import { getSettingsPageContext } from '@/app/settings/_lib'

export default async function SettingsAiPage() {
    const { userProfile, canViewSettings } = await getSettingsPageContext()
    if (!canViewSettings) return <div className="p-8"><h2 className="text-xl font-semibold">Unauthorized</h2></div>
    return <DashboardContent userProfile={userProfile} initialView="settings/ai" />
}
