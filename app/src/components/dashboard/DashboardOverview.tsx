'use client'

import { useState } from 'react'
import DashboardStatistics from './DashboardStatistics'
import ActionRequired from './ActionRequired'
import RecentActivities from './RecentActivities'

interface UserProfile {
  id: string
  email: string
  role_code: string
  organization_id: string
  is_active: boolean
  organizations: {
    id: string
    org_name: string
    org_type_code: string
    org_code: string
  }
  roles: {
    role_name: string
    role_level: number
  }
}

interface DashboardOverviewProps {
  userProfile: UserProfile
  onViewChange: (view: string) => void
}

export default function DashboardOverview({ userProfile, onViewChange }: DashboardOverviewProps) {
  const handleViewDocument = (orderId: string, documentId: string) => {
    // Store the order ID and document ID in session storage
    // Use 'trackingOrderId' to match what TrackOrderView expects
    sessionStorage.setItem('trackingOrderId', orderId)
    sessionStorage.setItem('selectedDocumentId', documentId)
    
    // Navigate to track order view
    onViewChange('track-order')
  }

  return (
    <div className="space-y-6">
      {/* Dashboard Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Dashboard Overview</h2>
        <p className="text-gray-600">
          Welcome back, {userProfile.organizations.org_name}
        </p>
        <p className="text-sm text-gray-500">
          {userProfile.roles.role_name} • {userProfile.email}
        </p>
      </div>

      {/* Statistics Cards */}
      <DashboardStatistics userProfile={userProfile} />

      {/* Action Required and Recent Activities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ActionRequired 
          userProfile={userProfile}
          onViewDocument={handleViewDocument}
        />
        <RecentActivities userProfile={userProfile} />
      </div>
    </div>
  )
}
