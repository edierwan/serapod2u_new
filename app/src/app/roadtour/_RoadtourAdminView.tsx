import DashboardContent from '@/components/dashboard/DashboardContent'
import { getRoadtourPageContext } from '@/app/roadtour/_lib'

/** Shared server renderer for RoadTour admin subpages (real URLs, same shell). */
export async function RoadtourAdminView({ view }: { view: string }) {
  const { userProfile } = await getRoadtourPageContext()
  return <DashboardContent userProfile={userProfile} initialView={view} />
}
