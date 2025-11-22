'use client'

import { useState, useEffect } from 'react'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { 
  Settings,
  Save,
  Search,
  Filter,
  RefreshCw,
  CheckSquare,
  Square,
  Copy,
  Upload,
  Download,
  AlertCircle,
  Info,
  ArrowLeft,
  Package
} from 'lucide-react'

interface InventoryItem {
  id: string
  variant_id: string
  variant_code: string
  variant_name: string
  variant_image_url: string | null
  product_name: string
  organization_id: string
  organization_name: string
  warehouse_location: string | null
  quantity_available: number
  reorder_point: number
  reorder_quantity: number
  max_stock_level: number | null
  safety_stock: number | null
  lead_time_days: number | null
}

interface StockSettings {
  reorder_point: string
  reorder_quantity: string
  max_stock_level: string
  safety_stock: string
  lead_time_days: string
}

interface InventorySettingsViewProps {
  userProfile: any
  onViewChange?: (view: string) => void
}

export default function InventorySettingsView({ userProfile, onViewChange }: InventorySettingsViewProps) {
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [filteredInventory, setFilteredInventory] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [productFilter, setProductFilter] = useState('all')
  const [locationFilter, setLocationFilter] = useState('all')
  const [products, setProducts] = useState<any[]>([])
  const [locations, setLocations] = useState<any[]>([])
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [bulkSettings, setBulkSettings] = useState<StockSettings>({
    reorder_point: '',
    reorder_quantity: '',
    max_stock_level: '',
    safety_stock: '',
    lead_time_days: ''
  })
  const [individualSettings, setIndividualSettings] = useState<Map<string, StockSettings>>(new Map())

  const { isReady, supabase } = useSupabaseAuth()
  const { toast } = useToast()

  useEffect(() => {
    if (isReady) {
      fetchInventory()
      fetchProducts()
      fetchLocations()
    }
  }, [isReady])

  useEffect(() => {
    filterInventory()
  }, [inventory, searchQuery, productFilter, locationFilter])

  const fetchInventory = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('product_inventory')
        .select(`
          id,
          variant_id,
          organization_id,
          quantity_on_hand,
          quantity_allocated,
          quantity_available,
          reorder_point,
          reorder_quantity,
          max_stock_level,
          safety_stock,
          lead_time_days,
          warehouse_location,
          product_variants (
            id,
            variant_code,
            variant_name,
            image_url,
            products (
              product_name
            )
          ),
          organizations (
            id,
            org_name
          )
        `)
        .eq('is_active', true)
        .order('variant_id')

      if (error) throw error

      const normalized: InventoryItem[] = (data || []).map((item: any) => {
        const variant = Array.isArray(item.product_variants) ? item.product_variants[0] : item.product_variants
        const product = variant?.products ? (Array.isArray(variant.products) ? variant.products[0] : variant.products) : null
        const org = Array.isArray(item.organizations) ? item.organizations[0] : item.organizations

        return {
          id: item.id,
          variant_id: item.variant_id,
          variant_code: variant?.variant_code || 'N/A',
          variant_name: variant?.variant_name || 'Unknown',
          variant_image_url: variant?.image_url || null,
          product_name: product?.product_name || 'Unknown Product',
          organization_id: item.organization_id,
          organization_name: org?.org_name || 'Unknown Location',
          warehouse_location: item.warehouse_location,
          quantity_available: item.quantity_available || 0,
          reorder_point: item.reorder_point || 0,
          reorder_quantity: item.reorder_quantity || 0,
          max_stock_level: item.max_stock_level,
          safety_stock: item.safety_stock,
          lead_time_days: item.lead_time_days
        }
      })

      setInventory(normalized)
      
      // Initialize individual settings with current values
      const settingsMap = new Map<string, StockSettings>()
      normalized.forEach(item => {
        settingsMap.set(item.id, {
          reorder_point: item.reorder_point.toString(),
          reorder_quantity: item.reorder_quantity.toString(),
          max_stock_level: item.max_stock_level?.toString() || '',
          safety_stock: item.safety_stock?.toString() || '0',
          lead_time_days: item.lead_time_days?.toString() || ''
        })
      })
      setIndividualSettings(settingsMap)
    } catch (error: any) {
      console.error('Error fetching inventory:', error)
      toast({
        title: 'Error',
        description: 'Failed to load inventory',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const fetchProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, product_name')
        .eq('is_active', true)
        .order('product_name')

      if (!error && data) {
        setProducts(data)
      }
    } catch (error) {
      console.error('Error fetching products:', error)
    }
  }

  const fetchLocations = async () => {
    try {
      const { data, error } = await supabase
        .from('organizations')
        .select('id, org_name')
        .eq('is_active', true)
        .order('org_name')

      if (!error && data) {
        setLocations(data)
      }
    } catch (error) {
      console.error('Error fetching locations:', error)
    }
  }

  const filterInventory = () => {
    let filtered = [...inventory]

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(item =>
        item.variant_code.toLowerCase().includes(query) ||
        item.variant_name.toLowerCase().includes(query) ||
        item.product_name.toLowerCase().includes(query)
      )
    }

    if (productFilter !== 'all') {
      filtered = filtered.filter(item => item.product_name === productFilter)
    }

    if (locationFilter !== 'all') {
      filtered = filtered.filter(item => item.organization_name === locationFilter)
    }

    setFilteredInventory(filtered)
  }

  const handleSelectAll = () => {
    if (selectedItems.size === filteredInventory.length) {
      setSelectedItems(new Set())
    } else {
      setSelectedItems(new Set(filteredInventory.map(item => item.id)))
    }
  }

  const handleSelectItem = (id: string) => {
    const newSelected = new Set(selectedItems)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedItems(newSelected)
  }

  const handleBulkSettingChange = (field: keyof StockSettings, value: string) => {
    setBulkSettings(prev => ({ ...prev, [field]: value }))
  }

  const handleIndividualSettingChange = (id: string, field: keyof StockSettings, value: string) => {
    const newSettings = new Map(individualSettings)
    const current = newSettings.get(id) || {
      reorder_point: '',
      reorder_quantity: '',
      max_stock_level: '',
      safety_stock: '',
      lead_time_days: ''
    }
    newSettings.set(id, { ...current, [field]: value })
    setIndividualSettings(newSettings)
  }

  const applyBulkSettings = () => {
    if (selectedItems.size === 0) {
      toast({
        title: 'No Items Selected',
        description: 'Please select items to apply bulk settings',
        variant: 'destructive'
      })
      return
    }

    const newSettings = new Map(individualSettings)
    selectedItems.forEach(id => {
      const current = newSettings.get(id) || {
        reorder_point: '',
        reorder_quantity: '',
        max_stock_level: '',
        safety_stock: '',
        lead_time_days: ''
      }
      newSettings.set(id, {
        reorder_point: bulkSettings.reorder_point || current.reorder_point,
        reorder_quantity: bulkSettings.reorder_quantity || current.reorder_quantity,
        max_stock_level: bulkSettings.max_stock_level || current.max_stock_level,
        safety_stock: bulkSettings.safety_stock || current.safety_stock,
        lead_time_days: bulkSettings.lead_time_days || current.lead_time_days
      })
    })
    setIndividualSettings(newSettings)

    toast({
      title: 'Settings Applied',
      description: `Bulk settings applied to ${selectedItems.size} item(s)`,
    })
  }

  const copyFromProduct = () => {
    if (productFilter === 'all') {
      toast({
        title: 'Filter Required',
        description: 'Please filter by product first',
        variant: 'destructive'
      })
      return
    }

    const productItems = filteredInventory.filter(item => item.product_name === productFilter)
    if (productItems.length === 0) return

    // Use the first item's settings as template
    const template = individualSettings.get(productItems[0].id)
    if (!template) return

    const newSettings = new Map(individualSettings)
    productItems.forEach(item => {
      if (selectedItems.has(item.id)) {
        newSettings.set(item.id, { ...template })
      }
    })
    setIndividualSettings(newSettings)

    toast({
      title: 'Settings Copied',
      description: `Settings copied to ${selectedItems.size} item(s)`,
    })
  }

  const handleSaveAll = async () => {
    try {
      setSaving(true)

      const updates = Array.from(individualSettings.entries()).map(([id, settings]) => {
        const item = inventory.find(i => i.id === id)
        if (!item) return null

        return {
          id,
          reorder_point: parseInt(settings.reorder_point) || 0,
          reorder_quantity: parseInt(settings.reorder_quantity) || 0,
          max_stock_level: settings.max_stock_level ? parseInt(settings.max_stock_level) : null,
          safety_stock: parseInt(settings.safety_stock) || 0,
          lead_time_days: settings.lead_time_days ? parseInt(settings.lead_time_days) : null
        }
      }).filter(Boolean)

      // Update one by one to ensure proper ID matching
      let successCount = 0
      let errorCount = 0
      
      for (const update of updates) {
        if (!update) continue
        
        const { error } = await supabase
          .from('product_inventory')
          .update({
            reorder_point: update.reorder_point,
            reorder_quantity: update.reorder_quantity,
            max_stock_level: update.max_stock_level,
            safety_stock: update.safety_stock,
            lead_time_days: update.lead_time_days,
            updated_at: new Date().toISOString()
          })
          .eq('id', update.id)

        if (error) {
          console.error(`Error updating item ${update.id}:`, error)
          errorCount++
        } else {
          successCount++
        }
      }

      if (errorCount > 0) {
        toast({
          title: 'Partial Success',
          description: `Updated ${successCount} item(s), ${errorCount} failed`,
          variant: 'destructive'
        })
      } else {
        toast({
          title: 'Success',
          description: `Updated ${successCount} inventory item(s)`,
        })
      }

      // Refresh data
      await fetchInventory()
      setSelectedItems(new Set())
    } catch (error: any) {
      console.error('Error saving settings:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to save settings',
        variant: 'destructive'
      })
    } finally {
      setSaving(false)
    }
  }

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('en-MY').format(value)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onViewChange?.('view-inventory')}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Inventory Settings</h1>
            <p className="text-gray-600">Manage stock rules and thresholds in bulk</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchInventory()}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700"
            onClick={handleSaveAll}
            disabled={saving}
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save All Changes
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Info Alert */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-900">
              <p className="font-medium mb-1">Bulk Settings Management</p>
              <ul className="list-disc list-inside space-y-1 text-blue-800">
                <li>Select multiple items using checkboxes to apply bulk settings</li>
                <li>Filter by product to manage all variants at once</li>
                <li>Use "Copy Settings" to replicate settings across similar items</li>
                <li>Individual edits override bulk settings before saving</li>
                <li>Click "Save All Changes" to apply all modifications</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Bulk Settings
          </CardTitle>
          <CardDescription>
            Apply settings to {selectedItems.size} selected item(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-5 gap-4 mb-4">
            <div>
              <Label className="text-xs">Reorder Point</Label>
              <Input
                type="number"
                min="0"
                placeholder="e.g., 500"
                value={bulkSettings.reorder_point}
                onChange={(e) => handleBulkSettingChange('reorder_point', e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Reorder Quantity</Label>
              <Input
                type="number"
                min="0"
                placeholder="e.g., 1000"
                value={bulkSettings.reorder_quantity}
                onChange={(e) => handleBulkSettingChange('reorder_quantity', e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Max Stock Level</Label>
              <Input
                type="number"
                min="0"
                placeholder="e.g., 3000"
                value={bulkSettings.max_stock_level}
                onChange={(e) => handleBulkSettingChange('max_stock_level', e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Safety Stock</Label>
              <Input
                type="number"
                min="0"
                placeholder="e.g., 100"
                value={bulkSettings.safety_stock}
                onChange={(e) => handleBulkSettingChange('safety_stock', e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Lead Time (days)</Label>
              <Input
                type="number"
                min="0"
                placeholder="e.g., 7"
                value={bulkSettings.lead_time_days}
                onChange={(e) => handleBulkSettingChange('lead_time_days', e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={applyBulkSettings}
              disabled={selectedItems.size === 0}
            >
              <Copy className="w-4 h-4 mr-2" />
              Apply to Selected
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={copyFromProduct}
              disabled={selectedItems.size === 0 || productFilter === 'all'}
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy Settings from First Item
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Filters and Search */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Search by product name, variant code, or variant name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Select value={productFilter} onValueChange={setProductFilter}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="All Products" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Products</SelectItem>
                {Array.from(new Set(inventory.map(item => item.product_name))).map(product => (
                  <SelectItem key={product} value={product}>{product}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={locationFilter} onValueChange={setLocationFilter}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {Array.from(new Set(inventory.map(item => item.organization_name))).map(location => (
                  <SelectItem key={location} value={location}>{location}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Inventory Settings Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Inventory Items</CardTitle>
              <CardDescription>
                {filteredInventory.length} item(s) found • {selectedItems.size} selected
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSelectAll}
                      className="p-0 h-auto"
                    >
                      {selectedItems.size === filteredInventory.length && filteredInventory.length > 0 ? (
                        <CheckSquare className="w-4 h-4" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </Button>
                  </TableHead>
                  <TableHead>Product / Variant</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead>Reorder Point</TableHead>
                  <TableHead>Reorder Qty</TableHead>
                  <TableHead>Max Stock</TableHead>
                  <TableHead>Safety Stock</TableHead>
                  <TableHead>Lead Time (days)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8">
                      Loading inventory...
                    </TableCell>
                  </TableRow>
                ) : filteredInventory.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8">
                      No inventory items found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredInventory.map((item) => {
                    const settings = individualSettings.get(item.id) || {
                      reorder_point: '',
                      reorder_quantity: '',
                      max_stock_level: '',
                      safety_stock: '',
                      lead_time_days: ''
                    }
                    const isSelected = selectedItems.has(item.id)

                    return (
                      <TableRow key={item.id} className={isSelected ? 'bg-blue-50' : ''}>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSelectItem(item.id)}
                            className="p-0 h-auto"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-blue-600" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="relative w-10 h-10 rounded-md overflow-hidden flex-shrink-0 bg-gray-100">
                              {item.variant_image_url ? (
                                <img
                                  src={item.variant_image_url}
                                  alt={item.variant_name}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none'
                                    const sibling = e.currentTarget.nextElementSibling as HTMLElement
                                    if (sibling) sibling.style.display = 'flex'
                                  }}
                                />
                              ) : null}
                              <div className="w-full h-full flex items-center justify-center text-gray-400" style={{ display: item.variant_image_url ? 'none' : 'flex' }}>
                                <Package className="w-5 h-5" />
                              </div>
                            </div>
                            <div>
                              <p className="text-sm font-medium">{item.product_name}</p>
                              <p className="text-xs text-gray-600">
                                {item.variant_code} • {item.variant_name}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm">{item.organization_name}</p>
                            {item.warehouse_location && (
                              <p className="text-xs text-gray-600">{item.warehouse_location}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm font-medium">{formatNumber(item.quantity_available)}</span>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            value={settings.reorder_point}
                            onChange={(e) => handleIndividualSettingChange(item.id, 'reorder_point', e.target.value)}
                            className="w-24 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            value={settings.reorder_quantity}
                            onChange={(e) => handleIndividualSettingChange(item.id, 'reorder_quantity', e.target.value)}
                            className="w-24 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            value={settings.max_stock_level}
                            onChange={(e) => handleIndividualSettingChange(item.id, 'max_stock_level', e.target.value)}
                            className="w-24 text-sm"
                            placeholder="Optional"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            value={settings.safety_stock}
                            onChange={(e) => handleIndividualSettingChange(item.id, 'safety_stock', e.target.value)}
                            className="w-24 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            value={settings.lead_time_days}
                            onChange={(e) => handleIndividualSettingChange(item.id, 'lead_time_days', e.target.value)}
                            className="w-24 text-sm"
                            placeholder="Optional"
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
