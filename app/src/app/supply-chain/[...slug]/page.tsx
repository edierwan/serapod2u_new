import DashboardContent from '@/components/dashboard/DashboardContent'
import { getSupplyChainPageContext } from '@/app/supply-chain/_lib'
import { resolveSupplyChainSlug } from '@/modules/supply-chain/supplyChainNav'

interface SupplyChainSubPageProps {
    params: Promise<{ slug?: string[] }>
}

export default async function SupplyChainSubPage({ params }: SupplyChainSubPageProps) {
    const { userProfile, canViewSupplyChain } = await getSupplyChainPageContext()
    const { slug = [] } = await params
    const { initialView, initialOrgId } = resolveSupplyChainSlug(slug)

    const orgType = userProfile.organizations?.org_type_code
    const roleLevel = userProfile.roles?.role_level
    const canManageInventorySettings =
        initialView !== 'inventory-settings' ||
        (orgType === 'HQ' && (roleLevel === 1 || roleLevel === 10))

    if (!canViewSupplyChain || !canManageInventorySettings) {
        return (
            <div className="p-8">
                <h2 className="text-xl font-semibold">Unauthorized</h2>
                <p>You do not have permission to view this Supply Chain page.</p>
            </div>
        )
    }

    return <DashboardContent userProfile={userProfile} initialView={initialView} initialOrgId={initialOrgId} />
}
