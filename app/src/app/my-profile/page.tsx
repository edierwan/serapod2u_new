import DashboardContent from '@/components/dashboard/DashboardContent'
import { getPortalPageContext } from '@/app/_lib/portal-page-context'

export default async function MyProfilePage() {
  const { userProfile } = await getPortalPageContext()
  return <DashboardContent userProfile={userProfile} initialView="my-profile" />
}
