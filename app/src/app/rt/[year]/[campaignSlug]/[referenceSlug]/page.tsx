import { redirect } from 'next/navigation'
import { resolveRoadTourByFriendlyPath } from '@/lib/roadtour/server'

interface PageProps {
    params: Promise<{ year: string; campaignSlug: string; referenceSlug: string }>
}

export default async function RoadtourAliasPage({ params }: PageProps) {
    const resolvedParams = await params
    const resolved = await resolveRoadTourByFriendlyPath({
        year: resolvedParams.year,
        campaignSlug: resolvedParams.campaignSlug,
        referenceSlugWithCode: resolvedParams.referenceSlug,
    })

    if (!resolved?.canonicalPath) {
        redirect('/scan')
    }

    redirect(resolved.canonicalPath)
}