import DashboardContent from '@/components/dashboard/DashboardContent'
import { getLoyaltyPageContext } from '@/app/loyalty/_lib'

/**
 * /loyalty — Loyalty module landing page.
 * Shows hero banner + sub-module cards (same pattern as Finance/Supply Chain landing).
 */
export default async function LoyaltyPage() {
    const { userProfile, canViewLoyalty } = await getLoyaltyPageContext()

    if (!canViewLoyalty) {
        return (
            <div className="p-8">
                <h2 className="text-xl font-semibold">Unauthorized</h2>
                <p>You do not have permission to view the Loyalty module.</p>
            </div>
        )
    }

    return <DashboardContent userProfile={userProfile} initialView="loyalty" />
}
