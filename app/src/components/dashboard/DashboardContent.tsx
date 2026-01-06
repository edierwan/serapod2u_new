'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
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

interface UserProfile {
  id: string
  email: string
  full_name: string | null
  phone: string | null
  role_code: string
  organization_id: string
  avatar_url: string | null
  signature_url: string | null
  is_active: boolean
  is_verified: boolean
  email_verified_at: string | null
  phone_verified_at: string | null
  last_login_at: string | null
  last_login_ip: string | null
  created_at: string
  updated_at: string
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
}

export default function DashboardContent({ userProfile, initialView, initialOrderId }: DashboardContentProps) {
  const router = useRouter()

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
        return <ViewOrderDetailsView userProfile={userProfile} onViewChange={handleViewChange} />
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

      case 'reporting':
        return <ReportingView userProfile={userProfile} />
      case 'settings':
        return <SettingsView userProfile={userProfile} />
      default:
        return <DashboardOverview userProfile={userProfile} onViewChange={handleViewChange} />
    }
  }

  return (
    <div className="min-h-screen bg-background flex">
      <div className="print:hidden">
        <Sidebar
          userProfile={userProfile}
          currentView={currentView}
          onViewChange={handleViewChange}
        />
      </div>
      {/* Main Content - Add left padding on desktop to account for sidebar, full width on mobile */}
      <div className="flex-1 w-full lg:ml-0">
        <main className="p-4 sm:p-6 h-full overflow-y-auto pt-16 lg:pt-6 print:p-0 print:pt-0 print:overflow-visible print:h-auto">
          {renderCurrentView()}
        </main>
      </div>
    </div>
  )
}