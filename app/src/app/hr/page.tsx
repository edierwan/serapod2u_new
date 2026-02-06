import { getHrPageContext } from '@/app/hr/_lib'
import HrEntryRouter from '@/components/hr/mobile/HrEntryRouter'

/**
 * /hr — Canonical HR entry point.
 *
 * On mobile (≤768 px) the client-side HrEntryRouter redirects to /hr/mobile/home.
 * On desktop it renders the existing DashboardContent with the HR landing view.
 */
export default async function HrPage() {
    const { userProfile, canViewHr } = await getHrPageContext()

    if (!canViewHr) {
        return (
            <div className="p-8">
                <h2 className="text-xl font-semibold">Unauthorized</h2>
                <p>You do not have permission to view this page.</p>
            </div>
        )
    }

    return <HrEntryRouter userProfile={userProfile} />
}
