'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Download, 
  Upload, 
  FileSpreadsheet, 
  CheckCircle, 
  AlertTriangle,
  Info,
  Building2,
  Package,
  Warehouse,
  Factory,
  ShoppingBag,
  Truck
} from 'lucide-react'

interface MigrationViewProps {
  userProfile: any
}

type TemplateType = 'products' | 'organizations' | 'inventory'
type OrgSubType = 'hq' | 'warehouse' | 'manufacturer' | 'distributor' | 'shop'

export default function MigrationView({ userProfile }: MigrationViewProps) {
  const [activeTab, setActiveTab] = useState<TemplateType>('products')
  const [selectedOrgType, setSelectedOrgType] = useState<OrgSubType>('hq')
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{
    success: boolean
    message: string
    details?: any
  } | null>(null)

  const templates = {
    products: {
      title: 'Product Masterdata',
      icon: Package,
      description: 'Import product information including SKU, name, brand, category, and pricing',
      filename: 'product_masterdata_template.xlsx',
      columns: [
        { field: 'product_code', label: 'Product Code*', example: 'PRD001', description: 'Unique product identifier' },
        { field: 'product_name', label: 'Product Name*', example: 'Sample Product', description: 'Full product name' },
        { field: 'brand_name', label: 'Brand Name', example: 'Brand X', description: 'Product brand (optional)' },
        { field: 'category_name', label: 'Category', example: 'Electronics', description: 'Product category (optional)' },
        { field: 'product_description', label: 'Description', example: 'Product description here', description: 'Detailed description (optional)' },
        { field: 'is_vape', label: 'Is Vape Product', example: 'Yes/No', description: 'Indicate if this is a vape product' },
        { field: 'age_restriction', label: 'Age Restriction', example: '18', description: 'Minimum age requirement (e.g., 18, 21)' },
      ]
    },
    organizations: {
      title: 'Organizations',
      icon: Building2,
      description: 'Import organization data for headquarters, warehouses, manufacturers, distributors, and shops',
      subtypes: {
        hq: { label: 'Headquarters', icon: Building2, filename: 'organizations_hq_template.xlsx' },
        warehouse: { label: 'Warehouses', icon: Warehouse, filename: 'organizations_warehouse_template.xlsx' },
        manufacturer: { label: 'Manufacturers', icon: Factory, filename: 'organizations_manufacturer_template.xlsx' },
        distributor: { label: 'Distributors', icon: Truck, filename: 'organizations_distributor_template.xlsx' },
        shop: { label: 'Shops', icon: ShoppingBag, filename: 'organizations_shop_template.xlsx' }
      },
      columns: [
        { field: 'org_code', label: 'Organization Code', example: 'HQ001', description: 'Auto-generated if empty' },
        { field: 'org_name', label: 'Organization Name*', example: 'Main HQ', description: 'Full organization name' },
        { field: 'registration_no', label: 'Registration No', example: '123456789', description: 'Business registration number' },
        { field: 'tax_id', label: 'Tax ID', example: 'TAX123', description: 'Tax identification number' },
        { field: 'website', label: 'Website', example: 'https://example.com', description: 'Organization website' },
        { field: 'address', label: 'Address Line 1', example: '123 Main Street', description: 'Street address' },
        { field: 'address_line2', label: 'Address Line 2', example: 'Suite 100', description: 'Additional address info' },
        { field: 'city', label: 'City', example: 'Kuala Lumpur', description: 'City name' },
        { field: 'postal_code', label: 'Postal Code', example: '50450', description: '5-digit postal code' },
        { field: 'contact_name', label: 'Contact Name', example: 'John Doe', description: 'Primary contact person' },
        { field: 'contact_title', label: 'Contact Title', example: 'Manager', description: 'Contact job title' },
        { field: 'contact_phone', label: 'Contact Phone', example: '+60123456789', description: 'Contact phone number' },
        { field: 'contact_email', label: 'Contact Email', example: 'contact@example.com', description: 'Contact email address' },
      ]
    },
    inventory: {
      title: 'Inventory & Stock',
      icon: FileSpreadsheet,
      description: 'Import initial stock levels for products across different locations',
      filename: 'inventory_stock_template.xlsx',
      columns: [
        { field: 'variant_code', label: 'Variant Code*', example: 'VAR001', description: 'Product variant code' },
        { field: 'organization_code', label: 'Location Code*', example: 'WH001', description: 'Warehouse/location code' },
        { field: 'quantity', label: 'Quantity*', example: '100', description: 'Stock quantity' },
        { field: 'unit_cost', label: 'Unit Cost', example: '10.50', description: 'Cost per unit (optional)' },
        { field: 'warehouse_location', label: 'Bin Location', example: 'A1-B2', description: 'Physical location in warehouse' },
        { field: 'reorder_point', label: 'Reorder Point', example: '20', description: 'Minimum stock level before reorder' },
        { field: 'reorder_quantity', label: 'Reorder Quantity', example: '50', description: 'Quantity to order when restocking' },
      ]
    }
  }

  const handleDownloadTemplate = (type: TemplateType, subtype?: OrgSubType) => {
    let filename = ''
    let csvContent = ''
    
    if (type === 'products') {
      filename = templates.products.filename
      const headers = templates.products.columns.map(col => col.label).join(',')
      const examples = templates.products.columns.map(col => col.example).join(',')
      csvContent = `${headers}\n${examples}\n`
    } else if (type === 'organizations' && subtype) {
      filename = templates.organizations.subtypes[subtype].filename
      const headers = templates.organizations.columns.map(col => col.label).join(',')
      const examples = templates.organizations.columns.map(col => col.example).join(',')
      csvContent = `${headers}\n${examples}\n`
    } else if (type === 'inventory') {
      filename = templates.inventory.filename
      const headers = templates.inventory.columns.map(col => col.label).join(',')
      const examples = templates.inventory.columns.map(col => col.example).join(',')
      csvContent = `${headers}\n${examples}\n`
    }

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename.replace('.xlsx', '.csv')
    link.click()
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>, type: TemplateType) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploading(true)
    setUploadResult(null)

    try {
      // TODO: Implement file parsing and database insertion
      // This is a placeholder for the actual implementation
      setTimeout(() => {
        setUploadResult({
          success: true,
          message: `Successfully uploaded ${file.name}. This is a demo - actual implementation will parse and import data.`,
          details: {
            fileName: file.name,
            fileSize: file.size,
            type: type
          }
        })
        setUploading(false)
      }, 2000)
    } catch (error: any) {
      setUploadResult({
        success: false,
        message: error.message || 'Failed to process file'
      })
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Data Migration</h2>
        <p className="text-gray-600">Import data in bulk using Excel or CSV templates</p>
      </div>

      {/* Instructions Alert */}
      <Alert className="border-blue-200 bg-blue-50">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800">
          <strong>How it works:</strong> Download the template for your data type, fill in the required information, 
          and upload it back to the system. The system will validate and import your data automatically.
        </AlertDescription>
      </Alert>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TemplateType)} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="products" className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            Products
          </TabsTrigger>
          <TabsTrigger value="organizations" className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Organizations
          </TabsTrigger>
          <TabsTrigger value="inventory" className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" />
            Inventory & Stock
          </TabsTrigger>
        </TabsList>

        {/* Products Tab */}
        <TabsContent value="products" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5" />
                {templates.products.title}
              </CardTitle>
              <CardDescription>{templates.products.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Template Info */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold mb-3">Template Columns:</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {templates.products.columns.map((col, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{col.label}</p>
                        <p className="text-xs text-gray-600">{col.description}</p>
                        <p className="text-xs text-gray-500 italic">Example: {col.example}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  onClick={() => handleDownloadTemplate('products')}
                  className="flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download Template
                </Button>
                
                <div className="flex-1">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => handleFileUpload(e, 'products')}
                    className="hidden"
                    id="upload-products"
                    disabled={uploading}
                  />
                  <label htmlFor="upload-products">
                    <Button
                      variant="outline"
                      className="w-full cursor-pointer"
                      disabled={uploading}
                      asChild
                    >
                      <span className="flex items-center gap-2">
                        <Upload className="w-4 h-4" />
                        {uploading ? 'Uploading...' : 'Upload Filled Template'}
                      </span>
                    </Button>
                  </label>
                </div>
              </div>

              {/* Upload Result */}
              {uploadResult && (
                <Alert className={uploadResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                  {uploadResult.success ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                  )}
                  <AlertDescription className={uploadResult.success ? 'text-green-800' : 'text-red-800'}>
                    {uploadResult.message}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Organizations Tab */}
        <TabsContent value="organizations" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                {templates.organizations.title}
              </CardTitle>
              <CardDescription>{templates.organizations.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Organization Type Selection */}
              <div>
                <label className="block text-sm font-medium mb-3">Select Organization Type:</label>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {Object.entries(templates.organizations.subtypes).map(([key, subtype]) => {
                    const Icon = subtype.icon
                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedOrgType(key as OrgSubType)}
                        className={`p-4 border-2 rounded-lg transition-all ${
                          selectedOrgType === key
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <Icon className={`w-6 h-6 mx-auto mb-2 ${
                          selectedOrgType === key ? 'text-blue-600' : 'text-gray-600'
                        }`} />
                        <p className={`text-sm font-medium ${
                          selectedOrgType === key ? 'text-blue-900' : 'text-gray-700'
                        }`}>
                          {subtype.label}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Template Info */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold mb-3">Template Columns:</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {templates.organizations.columns.map((col, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{col.label}</p>
                        <p className="text-xs text-gray-600">{col.description}</p>
                        <p className="text-xs text-gray-500 italic">Example: {col.example}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  onClick={() => handleDownloadTemplate('organizations', selectedOrgType)}
                  className="flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download {templates.organizations.subtypes[selectedOrgType].label} Template
                </Button>
                
                <div className="flex-1">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => handleFileUpload(e, 'organizations')}
                    className="hidden"
                    id="upload-organizations"
                    disabled={uploading}
                  />
                  <label htmlFor="upload-organizations">
                    <Button
                      variant="outline"
                      className="w-full cursor-pointer"
                      disabled={uploading}
                      asChild
                    >
                      <span className="flex items-center gap-2">
                        <Upload className="w-4 h-4" />
                        {uploading ? 'Uploading...' : 'Upload Filled Template'}
                      </span>
                    </Button>
                  </label>
                </div>
              </div>

              {/* Upload Result */}
              {uploadResult && (
                <Alert className={uploadResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                  {uploadResult.success ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                  )}
                  <AlertDescription className={uploadResult.success ? 'text-green-800' : 'text-red-800'}>
                    {uploadResult.message}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Inventory Tab */}
        <TabsContent value="inventory" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" />
                {templates.inventory.title}
              </CardTitle>
              <CardDescription>{templates.inventory.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Important Notes */}
              <Alert className="border-yellow-200 bg-yellow-50">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-yellow-800">
                  <strong>Important:</strong> Make sure products and organizations are already created before importing inventory data.
                  The system will match records by variant codes and organization codes.
                </AlertDescription>
              </Alert>

              {/* Template Info */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-semibold mb-3">Template Columns:</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {templates.inventory.columns.map((col, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{col.label}</p>
                        <p className="text-xs text-gray-600">{col.description}</p>
                        <p className="text-xs text-gray-500 italic">Example: {col.example}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  onClick={() => handleDownloadTemplate('inventory')}
                  className="flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download Template
                </Button>
                
                <div className="flex-1">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => handleFileUpload(e, 'inventory')}
                    className="hidden"
                    id="upload-inventory"
                    disabled={uploading}
                  />
                  <label htmlFor="upload-inventory">
                    <Button
                      variant="outline"
                      className="w-full cursor-pointer"
                      disabled={uploading}
                      asChild
                    >
                      <span className="flex items-center gap-2">
                        <Upload className="w-4 h-4" />
                        {uploading ? 'Uploading...' : 'Upload Filled Template'}
                      </span>
                    </Button>
                  </label>
                </div>
              </div>

              {/* Upload Result */}
              {uploadResult && (
                <Alert className={uploadResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                  {uploadResult.success ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-red-600" />
                  )}
                  <AlertDescription className={uploadResult.success ? 'text-green-800' : 'text-red-800'}>
                    {uploadResult.message}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
