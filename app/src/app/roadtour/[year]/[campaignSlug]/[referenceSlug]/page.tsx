import { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import RoadtourJourneyWrapper from '@/modules/roadtour/components/RoadtourJourneyWrapper'
import { buildRoadtourContextFromValidation, resolveRoadTourByFriendlyPath, validateRoadtourToken } from '@/lib/roadtour/server'

export const metadata: Metadata = {
    title: 'RoadTour Scan | Serapod2U',
    description: 'RoadTour QR landing page',
}

interface PageProps {
    params: Promise<{ year: string; campaignSlug: string; referenceSlug: string }>
}

export default async function FriendlyRoadtourPage({ params }: PageProps) {
    const resolvedParams = await params
    const resolved = await resolveRoadTourByFriendlyPath({
        year: resolvedParams.year,
        campaignSlug: resolvedParams.campaignSlug,
        referenceSlugWithCode: resolvedParams.referenceSlug,
    })

    if (!resolved) {
        redirect('/scan')
    }

    if (!resolved.isCanonical && resolved.canonicalPath) {
        redirect(resolved.canonicalPath)
    }

    const tokenValidation = await validateRoadtourToken(resolved.qr.token)
    if (!tokenValidation.valid) {
        redirect(`/scan?rt=${resolved.qr.token}`)
    }

    const roadtourContext = buildRoadtourContextFromValidation(resolved.qr.token, tokenValidation.data)

    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>}>
            <RoadtourJourneyWrapper roadtourContext={roadtourContext} orgId={tokenValidation.data.org_id} />
        </Suspense>
    )
}