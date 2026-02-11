import DashboardContent from '@/components/dashboard/DashboardContent'
import { getCatalogPageContext } from '@/app/catalog/_lib'

/**
 * /catalog — Catalog module landing page.
 * Shows hero banner + sub-module cards (same pattern as Finance/Supply Chain landing).
 */
export default async function CatalogPage() {
    const { userProfile, canViewCatalog } = await getCatalogPageContext()

    if (!canViewCatalog) {
        return (
            <div className="p-8">
                <h2 className="text-xl font-semibold">Unauthorized</h2>
                <p>You do not have permission to view the Catalog module.</p>
            </div>
        )
    }

    return <DashboardContent userProfile={userProfile} initialView="catalog" />
}
