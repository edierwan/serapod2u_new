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
    // Always use localhost:3000 for server-side rendering in development
    const baseUrl = process.env.NODE_ENV === 'production'
      ? (process.env.NEXT_PUBLIC_APP_URL || 'https://www.serapod2u.com')
      : 'http://localhost:3000'
    
    const apiUrl = `${baseUrl}/api/verify/${code}`
    
    console.log('🔍 getJourneyData - Fetching from:', apiUrl)
    
    const res = await fetch(apiUrl, {
      cache: 'no-store', // Always get fresh data
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      console.log('❌ Fetch not OK:', res.status, res.statusText)
      return { success: false, error: 'Failed to verify code' }
    }

    const result = await res.json()
    console.log('✅ API returned:', result.success ? 'SUCCESS' : 'FAILED')
    return result

  } catch (error) {
    console.error('❌ Error fetching journey data:', error)
    return { success: false, error: 'Network error' }
  }
}

export default async function TrackProductPage({ params }: PageProps) {
  const { code } = await params
  const result = await getJourneyData(code)

  // Debug logging
  console.log('🔍 Track Product Page - Code:', code)
  console.log('🔍 Track Product Page - API Result:', JSON.stringify(result, null, 2))

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicJourneyView 
        code={code}
        verificationResult={result}
      />
    </div>
  )
}
