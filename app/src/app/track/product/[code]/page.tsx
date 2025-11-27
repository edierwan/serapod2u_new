import { Metadata } from 'next'
import { headers } from 'next/headers'
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

function resolveBaseUrl() {
  const headersList = headers()
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host')
  const protocol = headersList.get('x-forwarded-proto') ?? 'https'

  if (host) {
    return `${protocol}://${host}`
  }

  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }

  return 'http://localhost:3000'
}

async function getJourneyData(code: string) {
  try {
    const baseUrl = resolveBaseUrl()
    const response = await fetch(`${baseUrl}/api/verify/${encodeURIComponent(code)}`, {
      method: 'GET',
      cache: 'no-store',
      next: { revalidate: 0 },
    })

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null)
      const errorMessage = errorBody?.error || 'Failed to verify QR code'
      return { success: false, error: errorMessage }
    }

    return await response.json()
  } catch (error) {
    console.error('❌ Error fetching journey data via verify API:', error)
    return { success: false, error: 'Failed to verify QR code' }
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
