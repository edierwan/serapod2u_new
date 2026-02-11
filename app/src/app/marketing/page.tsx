import DashboardContent from '@/components/dashboard/DashboardContent'
import { getMarketingPageContext } from '@/app/marketing/_lib'

/**
 * /marketing — Marketing module landing page.
 * Shows hero banner + sub-module cards (same pattern as Finance/Supply Chain landing).
 */
export default async function MarketingPage() {
    const { userProfile, canViewMarketing } = await getMarketingPageContext()

    if (!canViewMarketing) {
        return (
            <div className="p-8">
                <h2 className="text-xl font-semibold">Unauthorized</h2>
                <p>You do not have permission to view the Marketing module.</p>
            </div>
        )
    }

    return <DashboardContent userProfile={userProfile} initialView="mktg" />
}
