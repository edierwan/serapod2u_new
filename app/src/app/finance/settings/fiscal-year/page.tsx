import DashboardContent from '@/components/dashboard/DashboardContent'
import { getFinancePageContext } from '@/app/finance/_lib'

export default async function FiscalYearPage() {
    const { userProfile, canViewFinance } = await getFinancePageContext()

    if (!canViewFinance) {
        return (
            <div className="p-8">
                <h2 className="text-xl font-semibold">Unauthorized</h2>
                <p>You do not have permission to view this page.</p>
            </div>
        )
    }

    return <DashboardContent userProfile={userProfile} initialView="finance/settings/fiscal-year" />
}
