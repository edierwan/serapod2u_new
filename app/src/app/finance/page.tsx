import DashboardContent from '@/components/dashboard/DashboardContent'
import { getFinancePageContext } from '@/app/finance/_lib'

/**
 * /finance — Finance module landing page.
 * Shows hero banner + sub-module cards (like HR landing).
 */
export default async function FinancePage() {
    const { userProfile, canViewFinance } = await getFinancePageContext()

    if (!canViewFinance) {
        return (
            <div className="p-8">
                <h2 className="text-xl font-semibold">Unauthorized</h2>
                <p>You do not have permission to view the Finance module.</p>
            </div>
        )
    }

    return <DashboardContent userProfile={userProfile} initialView="finance" />
}
