'use client'

import { useState } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import ProductsView from '@/components/products/ProductsView'
import AddProductView from '@/components/products/AddProductView'
import ViewProductDetails from '@/components/products/ViewProductDetails'
import EditProductView from '@/components/products/EditProductView'
import ProductManagement from '@/components/products/ProductManagement'
import OrdersView from '@/components/orders/OrdersView'
import CreateOrderView from '@/components/orders/CreateOrderView'
import TrackOrderView from '@/components/dashboard/views/orders/TrackOrderView'
import InventoryView from '@/components/inventory/InventoryView'
import OrganizationsView from '@/components/organizations/OrganizationsView'
import AddOrganizationView from '@/components/organizations/AddOrganizationView'
import EditOrganizationView from '@/components/organizations/EditOrganizationView'
import DistributorsView from '@/components/distributors/DistributorsView'
import UsersView from '@/components/users/UsersView'
import MyProfileView from '@/components/dashboard/views/MyProfileView'
import ReportsView from '@/components/reports/ReportsView'
import SettingsView from '@/components/settings/SettingsView'
import DashboardOverview from '@/components/dashboard/DashboardOverview'
// QR Tracking Components
import QRBatchesView from '@/components/dashboard/views/qr-tracking/QRBatchesView'
import ManufacturerScanView from '@/components/dashboard/views/qr-tracking/ManufacturerScanView'
import WarehouseReceiveView from '@/components/dashboard/views/qr-tracking/WarehouseReceiveView'
import WarehouseShipView from '@/components/dashboard/views/qr-tracking/WarehouseShipView'
import ConsumerScanView from '@/components/dashboard/views/qr-tracking/ConsumerScanView'
import QRValidationView from '@/components/dashboard/views/qr-tracking/QRValidationView'
// Consumer Engagement Components
import RedemptionCatalogView from '@/components/dashboard/views/consumer-engagement/RedemptionCatalogView'
import LuckyDrawView from '@/components/dashboard/views/consumer-engagement/LuckyDrawView'
import ConsumerActivationsView from '@/components/dashboard/views/consumer-engagement/ConsumerActivationsView'
import { Card, CardContent } from '@/components/ui/card'
import { 
  Package
} from 'lucide-react'

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

interface DashboardContentProps {
  userProfile: UserProfile
}

export default function DashboardContent({ userProfile }: DashboardContentProps) {
  const [currentView, setCurrentView] = useState('dashboard')

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
      case 'track-order':
        return <TrackOrderView userProfile={userProfile} onViewChange={handleViewChange} />
      
      // QR Tracking Views
      case 'qr-batches':
        return <QRBatchesView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'manufacturer-scan':
        return <ManufacturerScanView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'warehouse-receive':
        return <WarehouseReceiveView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'warehouse-ship':
        return <WarehouseShipView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'consumer-scan':
        return <ConsumerScanView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'qr-validation':
        return <QRValidationView userProfile={userProfile} onViewChange={handleViewChange} />
      
      // Consumer Engagement Views
      case 'redemption-catalog':
        return <RedemptionCatalogView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'lucky-draw':
        return <LuckyDrawView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'consumer-activations':
        return <ConsumerActivationsView userProfile={userProfile} onViewChange={handleViewChange} />
      
      case 'inventory':
        return <InventoryView userProfile={userProfile} />
      case 'organizations':
        return <OrganizationsView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'add-organization':
        return <AddOrganizationView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'edit-organization':
        // For non-HQ orgs, show dedicated edit page
        return <EditOrganizationView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'edit-organization-hq':
        // For HQ orgs, go to Settings
        setCurrentView('settings')
        return <SettingsView userProfile={userProfile} />
      case 'view-organization':
        // Navigate back to organizations view
        setCurrentView('organizations')
        return <OrganizationsView userProfile={userProfile} onViewChange={handleViewChange} />
      case 'distributors':
        return <DistributorsView userProfile={userProfile} />
      case 'my-profile':
        return <MyProfileView userProfile={userProfile} />
      case 'users':
        return <UsersView userProfile={userProfile} />
      case 'reports':
        return <ReportsView userProfile={userProfile} />
      case 'settings':
        return <SettingsView userProfile={userProfile} />
      default:
        return <DashboardOverview userProfile={userProfile} onViewChange={handleViewChange} />
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar 
        userProfile={userProfile} 
        currentView={currentView} 
        onViewChange={handleViewChange} 
      />
      <div className="flex-1 overflow-hidden">
        <main className="p-6 h-full overflow-y-auto">
          {renderCurrentView()}
        </main>
      </div>
    </div>
  )
}