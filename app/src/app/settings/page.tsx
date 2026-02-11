import DashboardContent from '@/components/dashboard/DashboardContent'
import { getSettingsPageContext } from '@/app/settings/_lib'

/**
 * /settings — Settings module landing page.
 * Shows hero banner + category cards (like HR/Finance landing).
 */
export default async function SettingsPage() {
    const { userProfile, canViewSettings } = await getSettingsPageContext()

    if (!canViewSettings) {
        return (
            <div className="p-8">
                <h2 className="text-xl font-semibold">Unauthorized</h2>
                <p>You do not have permission to view Settings.</p>
            </div>
        )
    }

    return <DashboardContent userProfile={userProfile} initialView="settings" />
}
