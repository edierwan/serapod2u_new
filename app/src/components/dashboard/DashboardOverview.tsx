'use client'

import { useState } from 'react'
import DashboardStatistics from './DashboardStatistics'
import ActionRequired from './ActionRequired'
import RecentActivities from './RecentActivities'
import SupplyChainProgressBoard from './SupplyChainProgressBoard'
import ModuleBanner from '@/components/ui/ModuleBanner'

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

export default function DashboardOverview({ userProfile, onViewChange, bannerImageUrl }: DashboardOverviewProps) {
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
      {/* Dashboard Header — uses unified ModuleBanner */}
      <ModuleBanner
        module="dashboard"
        title={`${getGreeting()}${userProfile.organizations?.org_name ? ',' : ''}`}
        subtitle={userProfile.organizations?.org_name || undefined}
        userName={userProfile.email}
        bannerImageUrl={bannerImageUrl}
      />

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

      {/* Network Supply Pipeline */}
      <SupplyChainProgressBoard userProfile={userProfile} />
    </div>
  )
}
