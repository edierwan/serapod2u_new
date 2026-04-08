import DashboardContent from '@/components/dashboard/DashboardContent'
import { getRoadtourPageContext } from '@/app/roadtour/_lib'

export default async function RoadtourPage() {
  const { userProfile } = await getRoadtourPageContext()
  return <DashboardContent userProfile={userProfile} initialView="roadtour" />
}
