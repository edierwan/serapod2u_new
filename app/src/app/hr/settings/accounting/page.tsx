import DashboardContent from '@/components/dashboard/DashboardContent'
import { getHrPageContext } from '@/app/hr/_lib'

export default async function HrSettingsAccountingPage() {
    const { userProfile, canViewHr } = await getHrPageContext()

    if (!canViewHr) {
        return (
            <div className="p-8">
                <h2 className="text-xl font-semibold">Unauthorized</h2>
                <p>You do not have permission to view this page.</p>
            </div>
        )
    }

    return <DashboardContent userProfile={userProfile} initialView="hr/settings/accounting" />
}
