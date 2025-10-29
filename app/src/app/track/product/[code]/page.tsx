import { Metadata } from 'next'
import PublicJourneyView from '@/components/journey/PublicJourneyView'

export const metadata: Metadata = {
  title: 'Track Product | Serapod2U',
  description: 'Track your product and access exclusive rewards',
}

interface PageProps {
  params: Promise<{
    code: string
  }>
}

async function getJourneyData(code: string) {
  try {
    // Call our public API endpoint
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const res = await fetch(`${baseUrl}/api/verify/${code}`, {
      cache: 'no-store', // Always get fresh data
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      return { success: false, error: 'Failed to verify code' }
    }

    const result = await res.json()
    return result

  } catch (error) {
    console.error('Error fetching journey data:', error)
    return { success: false, error: 'Network error' }
  }
}

export default async function TrackProductPage({ params }: PageProps) {
  const { code } = await params
  const result = await getJourneyData(code)

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicJourneyView 
        code={code}
        verificationResult={result}
      />
    </div>
  )
}
