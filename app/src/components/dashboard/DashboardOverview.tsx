'use client'

import DashboardStatistics from './DashboardStatistics'
import ActionRequired from './ActionRequired'
import RecentActivities from './RecentActivities'

interface UserProfile {
  id: string
  email: string
  role_code: string
  organization_id: string | null
  is_active: boolean
  organizations: {
    id: string
    org_name: string
    org_type_code: string
    org_code: string
  } | null
  roles: {
    role_name: string
    role_level: number
  }
}

interface DashboardOverviewProps {
  userProfile: UserProfile
  onViewChange: (view: string) => void
  bannerImageUrl?: string | null
}

export default function DashboardOverview({ userProfile, onViewChange }: DashboardOverviewProps) {
  const handleViewDocument = (orderId: string, documentId: string, docType: 'PO' | 'INVOICE' | 'PAYMENT' | 'RECEIPT' | 'PAYMENT_REQUEST', docNo?: string) => {
    // Store the order ID and document ID in session storage
    // Use 'trackingOrderId' to match what TrackOrderView expects
    sessionStorage.setItem('trackingOrderId', orderId)
    sessionStorage.setItem('selectedDocumentId', documentId)
    sessionStorage.setItem('selectedDocumentType', docType)

    // Map document type to the correct tab
    let initialTab = 'po' // default
    if (docType === 'INVOICE') {
      // Check if it's deposit invoice or final invoice
      initialTab = docNo?.includes('-DEP') ? 'depositInvoice' : 'invoice'
    } else if (docType === 'PAYMENT') {
      // Check if it's deposit payment or balance payment
      initialTab = docNo?.includes('-BAL') ? 'balancePayment' : 'depositPayment'
    } else if (docType === 'RECEIPT') {
      initialTab = 'receipt'
    } else if (docType === 'PAYMENT_REQUEST') {
      initialTab = 'balanceRequest'
    }

    // Store the initial tab to open
    sessionStorage.setItem('selectedDocumentTab', initialTab)

    // Navigate to track order view
    onViewChange('track-order')
  }

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  return (
    <div className="space-y-8">
      {/* Light greeting — same language as Login form side, not a heavy banner */}
      <header className="pt-1">
        <div className="h-1 w-12 rounded-sm bg-[var(--sera-orange)] mb-5" />
        <p className="text-xs font-medium tracking-[0.16em] uppercase text-[var(--sera-muted)] mb-2">
          Dashboard
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--sera-ink)] leading-tight">
          {getGreeting()}
          {userProfile.organizations?.org_name ? ',' : ''}
        </h1>
        {userProfile.organizations?.org_name && (
          <p className="mt-2 text-base sm:text-lg text-[var(--sera-muted)]">
            {userProfile.organizations.org_name}
          </p>
        )}
      </header>

      {/* Statistics Cards */}
      <DashboardStatistics userProfile={userProfile} />

      {/* Action Required and Recent Activities */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <ActionRequired
            userProfile={userProfile}
            onViewDocument={handleViewDocument}
            onViewChange={onViewChange}
          />
        </div>
        <div className="lg:col-span-2">
          <RecentActivities userProfile={userProfile} />
        </div>
      </div>
    </div>
  )
}
