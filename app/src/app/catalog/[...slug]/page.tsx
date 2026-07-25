import DashboardContent from '@/components/dashboard/DashboardContent'
import { getCatalogPageContext } from '@/app/catalog/_lib'
import { resolveCatalogSlug } from '@/modules/catalog/catalogNav'

interface CatalogSubPageProps {
  params: Promise<{ slug?: string[] }>
}

export default async function CatalogSubPage({ params }: CatalogSubPageProps) {
  const { userProfile, canViewCatalog } = await getCatalogPageContext()
  const { slug = [] } = await params
  const initialView = resolveCatalogSlug(slug)

  if (!canViewCatalog) {
    return (
      <div className="p-8">
        <h2 className="text-xl font-semibold">Unauthorized</h2>
        <p>You do not have permission to view the Catalog module.</p>
      </div>
    )
  }

  return <DashboardContent userProfile={userProfile} initialView={initialView} />
}
