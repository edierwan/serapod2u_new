import DashboardContent from '@/components/dashboard/DashboardContent'
import { getEcommercePageContext } from '@/app/ecommerce/_lib'

/**
 * /ecommerce — E-commerce module landing page.
 * Defaults to the Store Banner Manager (Hero Banners) view.
 * Part of the Customer & Growth domain.
 */
export default async function EcommercePage() {
    const { userProfile, canViewEcommerce } = await getEcommercePageContext()

    if (!canViewEcommerce) {
        return (
            <div className="p-8">
                <h2 className="text-xl font-semibold">Unauthorized</h2>
                <p>You do not have permission to view E-commerce management.</p>
            </div>
        )
    }

    return <DashboardContent userProfile={userProfile} initialView="store-banner-manager" />
}
