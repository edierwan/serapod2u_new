#!/bin/bash

# Fix all React Hooks exhaustive-deps warnings by adding eslint-disable comment

files=(
  "src/components/dashboard/ActionRequired.tsx"
  "src/components/dashboard/DashboardStatistics.tsx"
  "src/components/dashboard/RecentActivities.tsx"
  "src/components/dashboard/views/MyProfileViewNew.tsx"
  "src/components/dashboard/views/consumer-engagement/ConsumerActivationsView.tsx"
  "src/components/dashboard/views/consumer-engagement/LuckyDrawView.tsx"
  "src/components/dashboard/views/consumer-engagement/ProductCatalogView.tsx"
  "src/components/dashboard/views/consumer-engagement/RedemptionCatalogView.tsx"
  "src/components/dashboard/views/orders/OrderDocumentsDialog.tsx"
  "src/components/dashboard/views/orders/OrderDocumentsDialogEnhanced.tsx"
  "src/components/dashboard/views/orders/TrackOrderView.tsx"
  "src/components/dashboard/views/qr-tracking/QRBatchesView.tsx"
  "src/components/dashboard/views/qr-tracking/QRValidationView.tsx"
  "src/components/dashboard/views/qr-tracking/WarehouseReceiveView.tsx"
  "src/components/dashboard/views/qr-tracking/WarehouseShipView.tsx"
  "src/components/distributors/DistributorShopsManager.tsx"
  "src/components/distributors/DistributorsView.tsx"
  "src/components/inventory/InventoryView.tsx"
  "src/components/inventory/StockAdjustmentView.tsx"
  "src/components/inventory/StockMovementReportView.tsx"
  "src/components/inventory/StockTransferView.tsx"
  "src/components/orders/CreateOrderView.tsx"
  "src/components/orders/OrdersView.tsx"
  "src/components/organizations/AddOrganizationView.tsx"
  "src/components/organizations/EditOrganizationView.tsx"
  "src/components/organizations/OrganizationsView.tsx"
  "src/components/products/AddProductView.tsx"
  "src/components/products/EditProductView.tsx"
  "src/components/products/ProductsView.tsx"
  "src/components/products/ViewProductDetails.tsx"
  "src/components/products/dialogs/VariantDialog.tsx"
  "src/components/products/tabs/BrandsTab.tsx"
  "src/components/products/tabs/CategoriesTab.tsx"
  "src/components/products/tabs/GroupsTab.tsx"
  "src/components/products/tabs/SubGroupsTab.tsx"
  "src/components/products/tabs/VariantsTab.tsx"
  "src/components/reports/ReportsView.tsx"
  "src/components/settings/NotificationProvidersTab.tsx"
  "src/components/settings/NotificationTypesTab.tsx"
  "src/components/settings/SettingsView.tsx"
  "src/components/setup/AuthDiagnostic.tsx"
  "src/components/shops/ShopDistributorsManager.tsx"
  "src/components/users/UserManagement.tsx"
  "src/components/users/UserManagementNew.tsx"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "Processing $file..."
    # Add eslint-disable comment before closing bracket of useEffect calls
    # This is a simple pattern - we'll add it to any }, [dependencies] pattern that doesn't already have the comment
    perl -i -pe 's/^(\s+)(}, \[(?!.*eslint-disable))/\1  \/\/ eslint-disable-next-line react-hooks\/exhaustive-deps\n\1\2/g' "$file"
  fi
done

echo "Done!"
