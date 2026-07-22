'use client'

import { Package, PlusCircle, BarChart3, FileText } from 'lucide-react'
import ModuleLightHeader from '@/components/layout/ModuleLightHeader'
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
    sessionStorage.setItem('trackingOrderId', orderId)
    sessionStorage.setItem('selectedDocumentId', documentId)
    sessionStorage.setItem('selectedDocumentType', docType)

    let initialTab = 'po'
    if (docType === 'INVOICE') {
      initialTab = docNo?.includes('-DEP') ? 'depositInvoice' : 'invoice'
    } else if (docType === 'PAYMENT') {
      initialTab = docNo?.includes('-BAL') ? 'balancePayment' : 'depositPayment'
    } else if (docType === 'RECEIPT') {
      initialTab = 'receipt'
    } else if (docType === 'PAYMENT_REQUEST') {
      initialTab = 'balanceRequest'
    }

    sessionStorage.setItem('selectedDocumentTab', initialTab)
    onViewChange('track-order')
  }

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const quickLinks = [
    { label: 'Orders', icon: Package, view: 'orders' },
    { label: 'Create Order', icon: PlusCircle, view: 'create-order' },
    { label: 'Reporting', icon: BarChart3, view: 'reporting' },
    { label: 'Documents', icon: FileText, view: 'track-order' },
  ]

  return (
    <div className="sera-dashboard sera-module-landing">
      <ModuleLightHeader
        eyebrow="Dashboard"
        title={getGreeting()}
        actions={
          <div className="sera-dashboard__meta">
            {userProfile.roles?.role_name ? (
              <span className="sera-dashboard__meta-pill sera-dashboard__meta-pill--role">
                {userProfile.roles.role_name}
              </span>
            ) : null}
            {userProfile.organizations?.org_code ? (
              <span className="sera-dashboard__meta-pill">
                {userProfile.organizations.org_code}
              </span>
            ) : null}
          </div>
        }
      />

      <section className="sera-dashboard__section sera-dashboard-enter">
        <p className="sera-dashboard__section-label">Quick access</p>
        <div className="sera-dashboard__quick-links">
          {quickLinks.map(({ label, icon: Icon, view }) => (
            <button
              key={view}
              type="button"
              className="sera-dashboard__quick-link"
              onClick={() => onViewChange(view)}
            >
              <Icon strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="sera-dashboard__section sera-dashboard-enter sera-dashboard-enter--1">
        <p className="sera-dashboard__section-label">At a glance</p>
        <DashboardStatistics userProfile={userProfile} />
      </section>

      <section className="sera-dashboard__section sera-dashboard-enter sera-dashboard-enter--2">
        <p className="sera-dashboard__section-label">Your workspace</p>
        <div className="sera-dashboard__grid">
          <ActionRequired
            userProfile={userProfile}
            onViewDocument={handleViewDocument}
            onViewChange={onViewChange}
          />
          <RecentActivities userProfile={userProfile} />
        </div>
      </section>
    </div>
  )
}
