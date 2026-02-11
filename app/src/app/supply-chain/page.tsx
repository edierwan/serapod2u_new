import DashboardContent from '@/components/dashboard/DashboardContent'
import { getSupplyChainPageContext } from '@/app/supply-chain/_lib'

/**
 * /supply-chain — Supply Chain module landing page.
 * Shows hero banner + sub-module cards (same pattern as Finance/HR landing).
 */
export default async function SupplyChainPage() {
    const { userProfile, canViewSupplyChain } = await getSupplyChainPageContext()

    if (!canViewSupplyChain) {
        return (
            <div className="p-8">
                <h2 className="text-xl font-semibold">Unauthorized</h2>
                <p>You do not have permission to view the Supply Chain module.</p>
            </div>
        )
    }

    return <DashboardContent userProfile={userProfile} initialView="supply-chain" />
}
