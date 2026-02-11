import DashboardContent from '@/components/dashboard/DashboardContent'
import { getCustomerGrowthPageContext } from '@/app/customer-growth/_lib'

/**
 * /customer-growth — Customer & Growth domain landing page.
 * Shows hero banner + module cards (same pattern as Supply Chain landing).
 */
export default async function CustomerGrowthPage() {
    const { userProfile, canViewCustomerGrowth } = await getCustomerGrowthPageContext()

    if (!canViewCustomerGrowth) {
        return (
            <div className="p-8">
                <h2 className="text-xl font-semibold">Unauthorized</h2>
                <p>You do not have permission to view the Customer & Growth module.</p>
            </div>
        )
    }

    return <DashboardContent userProfile={userProfile} initialView="customer-growth" />
}
