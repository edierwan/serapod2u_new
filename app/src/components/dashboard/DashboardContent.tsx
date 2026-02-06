'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import { usePermissions } from '@/hooks/usePermissions'
import ProductsView from '@/components/products/ProductsView'
import AddProductView from '@/components/products/AddProductView'
import ViewProductDetails from '@/components/products/ViewProductDetails'
import EditProductView from '@/components/products/EditProductView'
import ProductManagement from '@/components/products/ProductManagement'
import OrdersView from '@/components/orders/OrdersView'
import CreateOrderView from '@/components/orders/CreateOrderView'
import ViewOrderDetailsView from '@/components/orders/ViewOrderDetailsView'
import TrackOrderView from '@/components/dashboard/views/orders/TrackOrderView'
import InventoryView from '@/components/inventory/InventoryView'
import InventorySettingsView from '@/components/inventory/InventorySettingsView'
import AddStockView from '@/components/inventory/AddStockView'
import StockAdjustmentView from '@/components/inventory/StockAdjustmentView'
import StockTransferView from '@/components/inventory/StockTransferView'
import StockMovementReportView from '@/components/inventory/StockMovementReportView'
import MigrationView from '@/components/migration/MigrationView'
import OrganizationsView from '@/components/organizations/OrganizationsView'
import AddOrganizationView from '@/components/organizations/AddOrganizationView'
import EditOrganizationView from '@/components/organizations/EditOrganizationView'
import DistributorsView from '@/components/distributors/DistributorsView'
import UsersView from '@/components/users/UsersView'
import MyProfileViewNew from '@/components/dashboard/views/MyProfileViewNew'

import ReportingView from '@/components/dashboard/views/reporting/ReportingView'
import SettingsView from '@/components/settings/SettingsView'
import DashboardOverview from '@/components/dashboard/DashboardOverview'
import HrPeopleView from '@/components/hr/HrPeopleView'
import HrOrgChartView from '@/components/hr/HrOrgChartView'
import HrDepartmentsView from '@/components/hr/HrDepartmentsView'
import HrPositionsView from '@/components/hr/HrPositionsView'
import HrSettingsView from '@/components/hr/HrSettingsView'
import HrAttendanceClockView from '@/components/hr/modules/HrAttendanceClockView'
import HrAttendanceTimesheetsView from '@/components/hr/modules/HrAttendanceTimesheetsView'
import HrLeaveTypesView from '@/components/hr/modules/HrLeaveTypesView'
import HrLeaveRequestsView from '@/components/hr/modules/HrLeaveRequestsView'
import HrLeaveApprovalFlowView from '@/components/hr/modules/HrLeaveApprovalFlowView'
import HrPayrollSalaryView from '@/components/hr/modules/HrPayrollSalaryView'
import HrPayrollAllowancesView from '@/components/hr/modules/HrPayrollAllowancesView'
import HrPayrollPayslipsView from '@/components/hr/modules/HrPayrollPayslipsView'
import HrPerformanceKpisView from '@/components/hr/modules/HrPerformanceKpisView'
import HrPerformanceAppraisalsView from '@/components/hr/modules/HrPerformanceAppraisalsView'
import HrPerformanceReviewsView from '@/components/hr/modules/HrPerformanceReviewsView'
import HrSettingsApprovalRulesView from '@/components/hr/modules/HrSettingsApprovalRulesView'
import HrSettingsPermissionsView from '@/components/hr/modules/HrSettingsPermissionsView'
import HRTopNav from '@/modules/hr/components/HRTopNav'
import HrLandingView from '@/modules/hr/components/HrLandingView'
import HrConfigurationView from '@/modules/hr/components/HrConfigurationView'
import { createClient } from '@/lib/supabase/client'
import { getStorageUrl } from '@/lib/utils'
// QR Tracking Components
import QRBatchesView from '@/components/dashboard/views/qr-tracking/QRBatchesView'
import ManufacturerScanViewV2 from '@/components/dashboard/views/qr-tracking/ManufacturerScanViewV2'
import ManufacturerScanView2 from '@/components/dashboard/views/qr-tracking/ManufacturerScanView2'
import WarehouseReceiveView2 from '@/components/dashboard/views/qr-tracking/WarehouseReceiveView2'
import WarehouseReceiveView from '@/components/dashboard/views/qr-tracking/WarehouseReceiveView'
import WarehouseShipV2 from '@/components/dashboard/views/qr-tracking/WarehouseShipV2'
import ConsumerScanView from '@/components/dashboard/views/qr-tracking/ConsumerScanView'

import DistributorOrderView from '@/components/orders/DistributorOrderView'
import ShopOrderView from '@/components/orders/ShopOrderView'
// Consumer Engagement Components
import LuckyDrawView from '@/components/dashboard/views/consumer-engagement/LuckyDrawView'
import ConsumerActivationsView from '@/components/dashboard/views/consumer-engagement/ConsumerActivationsView'
import ProductCatalogView from '@/components/dashboard/views/consumer-engagement/ProductCatalogView'
import RedeemGiftManagementView from '@/components/redeem-gift/RedeemGiftManagementView'
import JourneyBuilderV2 from '@/components/journey/JourneyBuilderV2'
import ScratchCardGameView from '@/components/dashboard/views/consumer-engagement/ScratchCardGameView'
import QualityIssuesView from '@/components/manufacturer/QualityIssuesView'
import UserProfileWrapper from '@/components/users/UserProfileWrapper'
import MarketingPage from '@/app/loyalty/marketing/page'
import { AdminSupportInboxV2 } from '@/components/support/AdminSupportInboxV2'

interface UserProfile {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  role_code: string
  organization_id: string | null
  avatar_url: string | null
  signature_url: string | null
  is_active: boolean | null
  is_verified: boolean | null
  email_verified_at: string | null
  phone_verified_at: string | null
  last_login_at: string | null
  last_login_ip: unknown
  created_at: string | null
  updated_at: string | null
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

interface DashboardContentProps {
  userProfile: UserProfile
  initialView?: string
  initialOrderId?: string
  initialTargetId?: string
}

export default function DashboardContent({ userProfile, initialView, initialOrderId, initialTargetId }: DashboardContentProps) {
  const router = useRouter()
  const { hasPermission } = usePermissions(
    userProfile.roles.role_level,
    userProfile.role_code,
    (userProfile as any).department_id
  )

  const canEditHr =
    userProfile.roles.role_level <= 20 ||
    hasPermission('manage_org_chart') ||
    hasPermission('edit_org_settings')

  // ── Sidebar collapse state (persisted in localStorage) ──────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('ui.sidebarCollapsed') === 'true'
    }
    return false
  })

  // ── HR banner image config ──────────────────────────────────────
  const [hrBannerUrl, setHrBannerUrl] = useState<string | null>(null)

  useEffect(() => {
    async function loadHrBanner() {
      if (!userProfile.organization_id) return
      try {
        const supabase = createClient()
        const { data } = await supabase
          .from('organizations')
          .select('settings')
          .eq('id', userProfile.organization_id)
          .single()

        let settings: Record<string, any> = {}
        if (typeof data?.settings === 'string') {
          try { settings = JSON.parse(data.settings) } catch { settings = {} }
        } else if (typeof data?.settings === 'object' && data?.settings !== null) {
          settings = data.settings as Record<string, any>
        }

        const bannerPath = settings?.hr_config?.banner_image_url
        if (bannerPath) {
          setHrBannerUrl(
            bannerPath.startsWith('http') ? bannerPath : getStorageUrl(bannerPath)
          )
        }
      } catch (e) {
        console.error('Failed to load HR banner config:', e)
      }
    }
    loadHrBanner()
  }, [userProfile.organization_id])

  // Check for stored view from sessionStorage (set by EngagementShell when navigating from other pages)
  const getInitialView = () => {
    if (typeof window !== 'undefined') {
      const storedView = sessionStorage.getItem('dashboardView')
      if (storedView) {
        sessionStorage.removeItem('dashboardView') // Clear after reading
        return storedView
      }
    }
    return initialView || 'dashboard'
  }

  const [currentView, setCurrentView] = useState(getInitialView)

  // Sync state with URL params when they change
  useEffect(() => {
    if (initialView) {
      setCurrentView(initialView)
    }
  }, [initialView])

  const handleViewChange = (view: string) => {
    // Don't clear org selection for edit/view flows
    if (view !== 'edit-organization' && view !== 'edit-organization-hq' && view !== 'view-organization') {
      sessionStorage.removeItem('selectedOrgId')
      sessionStorage.removeItem('selectedOrgType')
    }
    // Don't clear product selection for product edit/view flows
    if (view !== 'edit-product' && view !== 'view-product') {
      sessionStorage.removeItem('selectedProductId')
    }

    // Clear order selection when leaving order views
    if (view !== 'view-order' && view !== 'track-order') {
      sessionStorage.removeItem('viewOrderId')
    }

    if (view === 'point-catalog') {
      router.push('/engagement/catalog')
      return
    }

    if (view === 'point-catalog-admin' || view === 'point-catalog-admin-list') {
      router.push('/engagement/catalog/admin')
      return
    }

    if (view === 'point-catalog-admin-new') {
      router.push('/engagement/catalog/admin/new')
      return
    }

    setCurrentView(view)
  }

  const renderCurrentView = () => {
    switch (currentView) {
      case 'products':
        return <ProductsView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'view-product':
        return <ViewProductDetails userProfile={userProfile} onViewChange={handleViewChange} />
      case 'edit-product':
        return <EditProductView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'product-management':
        return <ProductManagement userProfile={userProfile} onViewChange={handleViewChange} />
      case 'add-product':
        return <AddProductView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'orders':
        return <OrdersView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'create-order':
        return <CreateOrderView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'view-order':
        return <ViewOrderDetailsView userProfile={userProfile} onViewChange={handleViewChange} orderId={initialOrderId} />
      case 'track-order':
        return <TrackOrderView userProfile={userProfile} onViewChange={handleViewChange} />

      // QR Tracking Views
      case 'qr-batches':
        return <QRBatchesView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'manufacturer-scan-v2':
        return <ManufacturerScanViewV2 userProfile={userProfile} onViewChange={handleViewChange} />
      case 'manufacturer-scan-2':
        return <ManufacturerScanView2 userProfile={userProfile} />
      case 'warehouse-receive':
        return <WarehouseReceiveView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'warehouse-receive-2':
        return <WarehouseReceiveView2 userProfile={userProfile} />
      case 'warehouse-ship-v2':
        return <WarehouseShipV2 userProfile={userProfile} onViewChange={handleViewChange} />
      case 'distributor-order':
        return <DistributorOrderView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'shop-order':
        return <ShopOrderView userProfile={userProfile} onViewChange={handleViewChange} />


      // Consumer Engagement Views
      case 'journey-builder':
        return <JourneyBuilderV2 userProfile={userProfile} />
      case 'marketing':
        return <MarketingPage />
      case 'support-inbox':
        return <AdminSupportInboxV2 />
      case 'lucky-draw':
        return (
          <LuckyDrawView
            userProfile={userProfile}
            onViewChange={handleViewChange}
            initialOrderId={initialOrderId}
          />
        )
      case 'scratch-card-game':
        return <ScratchCardGameView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'redeem-gift-management':
        return (
          <RedeemGiftManagementView
            userProfile={userProfile}
            onViewChange={handleViewChange}
            initialOrderId={initialOrderId}
          />
        )
      case 'consumer-activations':
        return <ConsumerActivationsView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'product-catalog':
        return <ProductCatalogView userProfile={userProfile} onViewChange={handleViewChange} />

      case 'manufacturer-quality-issues':
        return <QualityIssuesView userProfile={userProfile} />

      case 'inventory':
      case 'inventory-list':
        return <InventoryView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'inventory-settings':
        return <InventorySettingsView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'add-stock':
        return <AddStockView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'stock-adjustment':
        return <StockAdjustmentView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'stock-transfer':
        return <StockTransferView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'stock-movements':
        return <StockMovementReportView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'migration':
        return <MigrationView userProfile={userProfile} />
      case 'organizations':
        return <OrganizationsView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'add-organization':
        return <AddOrganizationView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'edit-organization':
        // For non-HQ orgs, show dedicated edit page
        return <EditOrganizationView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'edit-organization-hq':
        // For HQ orgs, go to Settings
        return <SettingsView userProfile={userProfile} />
      case 'view-organization':
        // Navigate back to organizations view
        return <OrganizationsView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'distributors':
        return <DistributorsView userProfile={userProfile} />
      case 'my-profile':
        return <MyProfileViewNew userProfile={userProfile} />
      case 'users':
        return <UsersView userProfile={userProfile} />
      case 'user-profile':
        return (
          <UserProfileWrapper
            targetUserId={initialTargetId || userProfile.id}
            currentUserProfile={userProfile}
            onBack={() => handleViewChange('users')}
          />
        )

      case 'reporting':
        return <ReportingView userProfile={userProfile} />
      case 'settings':
        return <SettingsView userProfile={userProfile} />
      case 'hr-people':
        return (
          <HrPeopleView
            organizationId={userProfile.organizations.id}
            canEdit={canEditHr}
          />
        )
      case 'hr-org-chart':
        return <HrOrgChartView userProfile={userProfile} />
      case 'hr-departments':
        return <HrDepartmentsView userProfile={userProfile} />
      case 'hr-positions':
        return (
          <HrPositionsView
            organizationId={userProfile.organizations.id}
            canEdit={canEditHr}
          />
        )
      case 'hr-settings':
        return (
          <HrSettingsView
            organizationId={userProfile.organizations.id}
            canEdit={canEditHr}
          />
        )
      case 'hr/people/employees':
        return (
          <HrPeopleView
            organizationId={userProfile.organizations.id}
            canEdit={canEditHr}
          />
        )
      case 'hr/people/org-chart':
        return <HrOrgChartView userProfile={userProfile} />
      case 'hr/people/departments':
        return <HrDepartmentsView userProfile={userProfile} />
      case 'hr/people/positions':
        return (
          <HrPositionsView
            organizationId={userProfile.organizations.id}
            canEdit={canEditHr}
          />
        )
      case 'hr/attendance/clock-in-out':
        return <HrAttendanceClockView userProfile={userProfile} />
      case 'hr/attendance/timesheets':
        return <HrAttendanceTimesheetsView userProfile={userProfile} />
      case 'hr/leave/types':
        return <HrLeaveTypesView />
      case 'hr/leave/requests':
        return <HrLeaveRequestsView />
      case 'hr/leave/approval-flow':
        return <HrLeaveApprovalFlowView />
      case 'hr/payroll/salary-structure':
        return <HrPayrollSalaryView userProfile={userProfile} />
      case 'hr/payroll/allowances-deductions':
        return <HrPayrollAllowancesView userProfile={userProfile} />
      case 'hr/payroll/payslips':
        return <HrPayrollPayslipsView userProfile={userProfile} />
      case 'hr/performance/kpis':
        return <HrPerformanceKpisView />
      case 'hr/performance/appraisals':
        return <HrPerformanceAppraisalsView />
      case 'hr/performance/reviews':
        return <HrPerformanceReviewsView />
      case 'hr/settings/departments':
        return <HrDepartmentsView userProfile={userProfile} />
      case 'hr/settings/positions':
        return (
          <HrPositionsView
            organizationId={userProfile.organizations.id}
            canEdit={canEditHr}
          />
        )
      case 'hr/settings/approval-rules':
        return <HrSettingsApprovalRulesView />
      case 'hr/settings/permissions':
        return <HrSettingsPermissionsView />
      case 'hr/settings/configuration':
        return (
          <HrConfigurationView
            organizationId={userProfile.organizations.id}
            canEdit={canEditHr}
          />
        )
      case 'hr':
        return <HrLandingView userName={userProfile.full_name} bannerImageUrl={hrBannerUrl} />
      default:
        return <DashboardOverview userProfile={userProfile} onViewChange={handleViewChange} />
    }
  }

  const isHrView = currentView === 'hr' || currentView.startsWith('hr/') || currentView.startsWith('hr-')

  const handleHrNavigate = (href: string) => {
    router.push(href)
  }

  return (
    <div className="min-h-screen bg-background flex">
      <div className="print:hidden shrink-0">
        <Sidebar
          userProfile={userProfile}
          currentView={currentView}
          onViewChange={handleViewChange}
          initialCollapsed={sidebarCollapsed}
          onCollapseChange={(c) => setSidebarCollapsed(c)}
        />
      </div>
      {/* Main Content - fills remaining space */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* HR Top Navigation — shown only on /hr/* routes */}
        {isHrView && (
          <HRTopNav currentView={currentView} onNavigate={handleHrNavigate} />
        )}
        <main className={`flex-1 overflow-y-auto px-4 md:px-6 lg:px-8 py-4 sm:py-6 ${isHrView ? '' : 'pt-16 lg:pt-6'} print:p-0 print:pt-0 print:overflow-visible print:h-auto`}>
          {renderCurrentView()}
        </main>
      </div>
    </div>
  )
}