import DashboardContent from '@/components/dashboard/DashboardContent'
import { getCrmPageContext } from '@/app/crm/_lib'
import { resolveCrmSlug } from '@/modules/crm/crmNav'

interface CrmSubPageProps {
  params: Promise<{ slug?: string[] }>
}

export default async function CrmSubPage({ params }: CrmSubPageProps) {
  const { userProfile, canViewCrm } = await getCrmPageContext()
  const { slug = [] } = await params
  const initialView = resolveCrmSlug(slug)

  if (!canViewCrm) {
    return (
      <div className="p-8">
        <h2 className="text-xl font-semibold">Unauthorized</h2>
        <p>You do not have permission to view the CRM module.</p>
      </div>
    )
  }

  return <DashboardContent userProfile={userProfile} initialView={initialView} />
}
