import DashboardContent from '@/components/dashboard/DashboardContent'
import { getCrmPageContext } from '@/app/crm/_lib'

/**
 * /crm — CRM module landing page.
 * Shows hero banner + sub-module cards (same pattern as Finance/Supply Chain landing).
 */
export default async function CrmPage() {
    const { userProfile, canViewCrm } = await getCrmPageContext()

    if (!canViewCrm) {
        return (
            <div className="p-8">
                <h2 className="text-xl font-semibold">Unauthorized</h2>
                <p>You do not have permission to view the CRM module.</p>
            </div>
        )
    }

    return <DashboardContent userProfile={userProfile} initialView="crm" />
}
