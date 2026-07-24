import DashboardContent from '@/components/dashboard/DashboardContent'
import { getPortalPageContext } from '@/app/_lib/portal-page-context'

interface UserProfilePageProps {
  params: Promise<{ id: string }>
}

export default async function UserProfilePage({ params }: UserProfilePageProps) {
  const { userProfile } = await getPortalPageContext()
  const { id } = await params
  return (
    <DashboardContent
      userProfile={userProfile}
      initialView="user-profile"
      initialTargetId={id}
    />
  )
}
