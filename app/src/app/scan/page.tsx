import { Metadata } from 'next'
import RoadtourScanPage from '@/modules/roadtour/components/RoadtourScanPage'

export const metadata: Metadata = {
  title: 'RoadTour Scan | Serapod2U',
  description: 'Scan a RoadTour QR code to earn bonus points',
}

export default function ScanPage() {
  return <RoadtourScanPage />
}
