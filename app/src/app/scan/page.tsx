import { Metadata } from 'next'
import { Suspense } from 'react'
import RoadtourJourneyWrapper from '@/modules/roadtour/components/RoadtourJourneyWrapper'
import { buildRoadtourContextFromValidation, validateRoadtourToken } from '@/lib/roadtour/server'

export const metadata: Metadata = {
    title: 'RoadTour Scan | Serapod2U',
    description: 'Scan a RoadTour QR code to earn bonus points',
}

interface PageProps {
    searchParams: Promise<{ rt?: string }>
}

export default async function ScanPage({ searchParams }: PageProps) {
    const params = await searchParams
    const token = params.rt

    if (!token) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50">
                <div className="text-center p-8">
                    <p className="text-lg font-semibold text-gray-800">Invalid Link</p>
                    <p className="text-sm text-gray-500 mt-2">No RoadTour QR token provided.</p>
                </div>
            </div>
        )
    }

    const result = await validateRoadtourToken(token)

    if (!result.valid) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50">
                <div className="text-center p-8">
                    <p className="text-lg font-semibold text-gray-800">Invalid QR Code</p>
                    <p className="text-sm text-gray-500 mt-2">{result.error}</p>
                </div>
            </div>
        )
    }

    const v = result.data
    const roadtourContext = buildRoadtourContextFromValidation(token, v)

    return (
        <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>}>
            <RoadtourJourneyWrapper roadtourContext={roadtourContext} orgId={v.org_id} />
        </Suspense>
    )
}
