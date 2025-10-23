'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
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
  Truck,
  Loader2
} from 'lucide-react'
import Papa from 'papaparse'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'

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
  
  const { toast } = useToast()
  const { supabase } = useSupabaseAuth()

  const templates = {
    products: {
      title: 'Product Masterdata',
      icon: Package,
      description: 'Import product information including SKU, name, brand, category, group, subgroup, manufacturer, variants, and pricing',
      filename: 'product_masterdata_template.xlsx',
      columns: [
        // Product Master Fields
        { field: 'product_code', label: 'Product Code*', example: 'PRD001', description: 'Unique product identifier (auto-generated if empty)' },
        { field: 'product_name', label: 'Product Name*', example: 'Vape Device Premium', description: 'Full product name (REQUIRED)' },
        { field: 'product_description', label: 'Product Description', example: 'High-quality vape device with advanced features', description: 'Detailed product description' },
        { field: 'brand_name', label: 'Brand Name*', example: 'VapeTech', description: 'Product brand - must exist in system first (REQUIRED)' },
        { field: 'category_name', label: 'Category*', example: 'Electronics', description: 'Product category - must exist in system first (REQUIRED)' },
        { field: 'group_name', label: 'Group*', example: 'Vaping Devices', description: 'Product group under category - must exist first (REQUIRED)' },
        { field: 'subgroup_name', label: 'SubGroup*', example: 'Premium Devices', description: 'Product sub-group under group - must exist first (REQUIRED)' },
        { field: 'manufacturer_name', label: 'Manufacturer*', example: 'TechFactory Ltd', description: 'Manufacturer organization name - must exist first (REQUIRED)' },
        { field: 'is_vape', label: 'Is Vape Product*', example: 'Yes', description: 'Yes/No - Indicate if vape product for compliance (REQUIRED)' },
        { field: 'age_restriction', label: 'Age Restriction', example: '18', description: 'Minimum age (18 or 21), default: 18' },
        
        // Variant Fields (Default Variant)
        { field: 'variant_code', label: 'Variant Code*', example: 'VAR-PRD001-01', description: 'Unique variant code (auto-generated if empty)' },
        { field: 'variant_name', label: 'Variant Name*', example: 'Black 2000mAh', description: 'Variant name - color, size, flavor, etc (REQUIRED)' },
        { field: 'base_cost', label: 'Base Cost (RM)*', example: '85.50', description: 'Unit cost price in RM (REQUIRED for inventory)' },
        { field: 'suggested_retail_price', label: 'Retail Price (RM)*', example: '150.00', description: 'Suggested retail price in RM (REQUIRED)' },
        { field: 'barcode', label: 'Barcode', example: '1234567890123', description: 'Product barcode/EAN (optional)' },
        { field: 'manufacturer_sku', label: 'Manufacturer SKU', example: 'MFG-12345', description: 'Manufacturer SKU (auto-generated if empty)' },
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
      description: 'Import initial stock levels for product variants across different warehouse locations',
      filename: 'inventory_stock_template.xlsx',
      columns: [
        { field: 'variant_code', label: 'Variant Code*', example: 'VAR-PRD001-01', description: 'Product variant code - must exist in system first (REQUIRED)' },
        { field: 'organization_code', label: 'Location Code*', example: 'WH001', description: 'Warehouse/organization code where stock is located (REQUIRED)' },
        { field: 'quantity_on_hand', label: 'Quantity On Hand*', example: '100', description: 'Current stock quantity (REQUIRED)' },
        { field: 'average_cost', label: 'Average Cost (RM)', example: '85.50', description: 'Average unit cost in RM (recommended for accurate valuation)' },
        { field: 'warehouse_location', label: 'Bin Location', example: 'A1-B2-C3', description: 'Physical location/bin in warehouse (optional)' },
        { field: 'reorder_point', label: 'Reorder Point', example: '20', description: 'Minimum stock level before reorder alert (default: 10)' },
        { field: 'reorder_quantity', label: 'Reorder Quantity', example: '50', description: 'Quantity to order when restocking (default: 50)' },
        { field: 'max_stock_level', label: 'Max Stock Level', example: '500', description: 'Maximum stock level (optional)' },
      ]
    }
  }

  const handleDownloadTemplate = (type: TemplateType, subtype?: OrgSubType) => {
    let filename = ''
    let csvContent = ''
    
    if (type === 'products') {
      filename = templates.products.filename
      const headers = templates.products.columns.map(col => col.label).join(',')
      
      // Provide 2 example rows to show the format
      const example1 = templates.products.columns.map(col => col.example).join(',')
      const example2 = [
        '', // product_code (auto-generated)
        'Vape Starter Kit',
        'Complete starter kit with charger and case',
        'VapeTech',
        'Electronics',
        'Vaping Devices',
        'Starter Kits',
        'TechFactory Ltd',
        'Yes',
        '21',
        '', // variant_code (auto-generated)
        'Silver 1500mAh',
        '75.00',
        '129.90',
        '9876543210987',
        ''  // manufacturer_sku (auto-generated)
      ].join(',')
      
      csvContent = `${headers}\n${example1}\n${example2}\n`
    } else if (type === 'organizations' && subtype) {
      filename = templates.organizations.subtypes[subtype].filename
      const headers = templates.organizations.columns.map(col => col.label).join(',')
      const examples = templates.organizations.columns.map(col => col.example).join(',')
      csvContent = `${headers}\n${examples}\n`
    } else if (type === 'inventory') {
      filename = templates.inventory.filename
      const headers = templates.inventory.columns.map(col => col.label).join(',')
      
      // Provide 2 example rows
      const example1 = templates.inventory.columns.map(col => col.example).join(',')
      const example2 = [
        'VAR-PRD001-01',
        'WH002',
        '250',
        '75.00',
        'B2-C3-D4',
        '30',
        '100',
        '1000'
      ].join(',')
      
      csvContent = `${headers}\n${example1}\n${example2}\n`
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
      if (type === 'products') {
        await handleProductImport(file)
      } else if (type === 'inventory') {
        await handleInventoryImport(file)
      } else if (type === 'organizations') {
        await handleOrganizationImport(file)
      }
    } catch (error: any) {
      console.error('Import error:', error)
      setUploadResult({
        success: false,
        message: error.message || 'Failed to process file'
      })
      setUploading(false)
      
      toast({
        title: 'Import Failed',
        description: error.message || 'Failed to process file',
        variant: 'destructive'
      })
    }
  }

  const handleProductImport = async (file: File) => {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          try {
            const rows = results.data as any[]
            let successCount = 0
            let errorCount = 0
            const errors: string[] = []

            for (let i = 0; i < rows.length; i++) {
              const row = rows[i]
              const rowNum = i + 2 // +2 because row 1 is header, and arrays are 0-indexed

              try {
                // Validate required fields
                if (!row['Product Name*']) {
                  throw new Error(`Row ${rowNum}: Product Name is required`)
                }
                if (!row['Brand Name*']) {
                  throw new Error(`Row ${rowNum}: Brand Name is required`)
                }
                if (!row['Category*']) {
                  throw new Error(`Row ${rowNum}: Category is required`)
                }
                if (!row['Group*']) {
                  throw new Error(`Row ${rowNum}: Group is required`)
                }
                if (!row['SubGroup*']) {
                  throw new Error(`Row ${rowNum}: SubGroup is required`)
                }
                if (!row['Manufacturer*']) {
                  throw new Error(`Row ${rowNum}: Manufacturer is required`)
                }
                if (!row['Variant Name*']) {
                  throw new Error(`Row ${rowNum}: Variant Name is required`)
                }
                if (!row['Base Cost (RM)*']) {
                  throw new Error(`Row ${rowNum}: Base Cost is required`)
                }
                if (!row['Retail Price (RM)*']) {
                  throw new Error(`Row ${rowNum}: Retail Price is required`)
                }

                // Lookup brand
                const { data: brand, error: brandError } = await supabase
                  .from('brands')
                  .select('id')
                  .eq('brand_name', row['Brand Name*'].trim())
                  .eq('is_active', true)
                  .single()

                if (brandError || !brand) {
                  throw new Error(`Row ${rowNum}: Brand "${row['Brand Name*']}" not found. Create it first via Product Management.`)
                }

                // Lookup category
                const { data: category, error: categoryError } = await supabase
                  .from('product_categories')
                  .select('id')
                  .eq('category_name', row['Category*'].trim())
                  .eq('is_active', true)
                  .single()

                if (categoryError || !category) {
                  throw new Error(`Row ${rowNum}: Category "${row['Category*']}" not found. Create it first.`)
                }

                // Lookup group
                const { data: group, error: groupError } = await supabase
                  .from('product_groups')
                  .select('id')
                  .eq('group_name', row['Group*'].trim())
                  .eq('category_id', category.id)
                  .eq('is_active', true)
                  .single()

                if (groupError || !group) {
                  throw new Error(`Row ${rowNum}: Group "${row['Group*']}" not found under category "${row['Category*']}".`)
                }

                // Lookup subgroup
                const { data: subgroup, error: subgroupError } = await supabase
                  .from('product_subgroups')
                  .select('id')
                  .eq('subgroup_name', row['SubGroup*'].trim())
                  .eq('group_id', group.id)
                  .eq('is_active', true)
                  .single()

                if (subgroupError || !subgroup) {
                  throw new Error(`Row ${rowNum}: SubGroup "${row['SubGroup*']}" not found under group "${row['Group*']}".`)
                }

                // Lookup manufacturer
                const { data: manufacturer, error: mfgError } = await supabase
                  .from('organizations')
                  .select('id')
                  .eq('org_name', row['Manufacturer*'].trim())
                  .eq('org_type_code', 'MFG')
                  .eq('is_active', true)
                  .single()

                if (mfgError || !manufacturer) {
                  throw new Error(`Row ${rowNum}: Manufacturer "${row['Manufacturer*']}" not found. Register it first via Organizations.`)
                }

                // Generate product code if not provided
                const productCode = row['Product Code*']?.trim() || `PRD${Date.now().toString().slice(-8)}`

                // Check if product code already exists
                const { data: existingProduct } = await supabase
                  .from('products')
                  .select('id, product_name')
                  .eq('product_code', productCode)
                  .single()

                if (existingProduct) {
                  throw new Error(`Row ${rowNum}: Product code "${productCode}" already exists for "${existingProduct.product_name}".`)
                }

                // Parse is_vape
                const isVapeText = row['Is Vape Product*']?.trim().toLowerCase()
                const isVape = isVapeText === 'yes' || isVapeText === 'y' || isVapeText === 'true' || isVapeText === '1'

                // Insert product
                const { data: product, error: productError } = await supabase
                  .from('products')
                  .insert({
                    product_code: productCode,
                    product_name: row['Product Name*'].trim(),
                    product_description: row['Product Description']?.trim() || null,
                    brand_id: brand.id,
                    category_id: category.id,
                    group_id: group.id,
                    subgroup_id: subgroup.id,
                    manufacturer_id: manufacturer.id,
                    is_vape: isVape,
                    age_restriction: row['Age Restriction'] ? parseInt(row['Age Restriction']) : (isVape ? 18 : null),
                    is_active: true,
                    created_by: userProfile.id
                  })
                  .select()
                  .single()

                if (productError) {
                  throw new Error(`Row ${rowNum}: Failed to create product - ${productError.message}`)
                }

                // Generate variant code if not provided
                const variantCode = row['Variant Code*']?.trim() || `VAR-${productCode}-01`

                // Insert variant
                const { error: variantError } = await supabase
                  .from('product_variants')
                  .insert({
                    product_id: product.id,
                    variant_code: variantCode,
                    variant_name: row['Variant Name*'].trim(),
                    base_cost: parseFloat(row['Base Cost (RM)*']),
                    suggested_retail_price: parseFloat(row['Retail Price (RM)*']),
                    barcode: row['Barcode']?.trim() || null,
                    manufacturer_sku: row['Manufacturer SKU']?.trim() || `SKU-${productCode}-${Date.now().toString().slice(-6)}`,
                    is_default: true,
                    is_active: true
                  })

                if (variantError) {
                  // Rollback product if variant fails
                  await supabase.from('products').delete().eq('id', product.id)
                  throw new Error(`Row ${rowNum}: Failed to create variant - ${variantError.message}`)
                }

                successCount++
              } catch (error: any) {
                errorCount++
                errors.push(error.message)
                console.error(`Row ${rowNum} error:`, error)
              }
            }

            setUploading(false)

            if (successCount > 0 && errorCount === 0) {
              setUploadResult({
                success: true,
                message: `✅ Successfully imported ${successCount} product(s)!`,
                details: { successCount, errorCount, total: rows.length }
              })
              
              toast({
                title: 'Import Successful!',
                description: `Imported ${successCount} products with variants.`,
              })
            } else if (successCount > 0 && errorCount > 0) {
              setUploadResult({
                success: true,
                message: `⚠️ Partially successful: ${successCount} imported, ${errorCount} failed.\n\nErrors:\n${errors.slice(0, 5).join('\n')}${errors.length > 5 ? `\n...and ${errors.length - 5} more errors` : ''}`,
                details: { successCount, errorCount, total: rows.length, errors }
              })
              
              toast({
                title: 'Partial Import',
                description: `${successCount} imported, ${errorCount} failed. Check results for details.`,
                variant: 'default'
              })
            } else {
              throw new Error(`All ${errorCount} rows failed:\n\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? `\n...and ${errors.length - 3} more errors` : ''}`)
            }

            resolve(true)
          } catch (error: any) {
            reject(error)
          }
        },
        error: (error) => {
          reject(new Error(`CSV parsing failed: ${error.message}`))
        }
      })
    })
  }

  const handleInventoryImport = async (file: File) => {
    // TODO: Implement inventory import
    toast({
      title: 'Not Implemented',
      description: 'Inventory import will be implemented next.',
      variant: 'default'
    })
    setUploading(false)
  }

  const handleOrganizationImport = async (file: File) => {
    // TODO: Implement organization import
    toast({
      title: 'Not Implemented',
      description: 'Organization import will be implemented next.',
      variant: 'default'
    })
    setUploading(false)
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
              {/* Prerequisites Warning */}
              <Alert className="border-amber-200 bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                  <strong>⚠️ Important Prerequisites:</strong> Before importing products, ensure these master data exist in your system:
                  <ul className="list-disc ml-5 mt-2 space-y-1">
                    <li><strong>Brands</strong> - Product brands must be created first</li>
                    <li><strong>Categories</strong> - Product categories must exist</li>
                    <li><strong>Groups</strong> - Product groups under each category</li>
                    <li><strong>SubGroups</strong> - Sub-groups under each group</li>
                    <li><strong>Manufacturers</strong> - Manufacturer organizations must be registered</li>
                  </ul>
                  <p className="mt-2">❗ Import will fail if any referenced master data doesn't exist. Create them via Product Management menu first.</p>
                </AlertDescription>
              </Alert>

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
                        {uploading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4" />
                        )}
                        {uploading ? 'Importing Products...' : 'Upload Filled Template'}
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
                  <AlertDescription className={uploadResult.success ? 'text-green-800 whitespace-pre-wrap' : 'text-red-800 whitespace-pre-wrap'}>
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
              {/* Prerequisites Warning */}
              <Alert className="border-amber-200 bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                  <strong>⚠️ Important Prerequisites:</strong> Before importing inventory, ensure:
                  <ul className="list-disc ml-5 mt-2 space-y-1">
                    <li><strong>Product Variants</strong> - Variants must exist with correct variant codes</li>
                    <li><strong>Organizations</strong> - Warehouses/locations must be registered with organization codes</li>
                    <li><strong>Matching Codes</strong> - Variant codes and organization codes in your file must match exactly</li>
                  </ul>
                  <p className="mt-2">💡 Tip: Export existing products and organizations first to get correct codes, then use them in your inventory file.</p>
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
