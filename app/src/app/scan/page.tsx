import { Metadata } from 'next'
import { Suspense } from 'react'
import RoadtourScanPage from '@/modules/roadtour/components/RoadtourScanPage'

export const metadata: Metadata = {
  title: 'RoadTour Scan | Serapod2U',
  description: 'Scan a RoadTour QR code to earn bonus points',
}

export default function ScanPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>}>
      <RoadtourScanPage />
    </Suspense>
  )
}
