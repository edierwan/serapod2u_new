'use client'

import { useState, useEffect } from 'react'
import { X, Save, AlertCircle, TrendingUp, Package, Clock, Shield, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { useSupabaseAuth } from '@/lib/hooks/useSupabaseAuth'

interface StockSettingsPanelProps {
  inventoryItem: {
    id: string
    variant_id: string
    variant_code: string
    variant_name: string
    product_name: string
    organization_id: string
    organization_name: string
    quantity_on_hand: number
    quantity_allocated: number
    quantity_available: number
    reorder_point: number
    reorder_quantity: number
    max_stock_level: number | null
    safety_stock: number | null
    lead_time_days: number | null
    total_value: number | null
    warehouse_location: string | null
  }
  onClose: () => void
  onSave: () => void
}

export default function StockSettingsPanel({ inventoryItem, onClose, onSave }: StockSettingsPanelProps) {
  const [reorderPoint, setReorderPoint] = useState(inventoryItem.reorder_point.toString())
  const [reorderQuantity, setReorderQuantity] = useState(inventoryItem.reorder_quantity.toString())
  const [maxStockLevel, setMaxStockLevel] = useState(inventoryItem.max_stock_level?.toString() || '')
  const [safetyStock, setSafetyStock] = useState(inventoryItem.safety_stock?.toString() || '0')
  const [leadTimeDays, setLeadTimeDays] = useState(inventoryItem.lead_time_days?.toString() || '')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const { supabase } = useSupabaseAuth()
  const { toast } = useToast()

  const formatNumber = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '0'
    return new Intl.NumberFormat('en-MY').format(value)
  }

  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '0.00'
    return new Intl.NumberFormat('en-MY', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value)
  }

  const validate = () => {
    const newErrors: Record<string, string> = {}

    const reorderPt = parseInt(reorderPoint)
    const reorderQty = parseInt(reorderQuantity)
    const maxStock = maxStockLevel ? parseInt(maxStockLevel) : null
    const safety = parseInt(safetyStock)
    const leadTime = leadTimeDays ? parseInt(leadTimeDays) : null

    if (isNaN(reorderPt) || reorderPt < 0) {
      newErrors.reorderPoint = 'Must be a non-negative number'
    }

    if (isNaN(reorderQty) || reorderQty < 0) {
      newErrors.reorderQuantity = 'Must be a non-negative number'
    }

    if (maxStockLevel && (isNaN(maxStock!) || maxStock! < 0)) {
      newErrors.maxStockLevel = 'Must be a non-negative number'
    }

    if (maxStockLevel && maxStock! > 0 && reorderPt > maxStock!) {
      newErrors.maxStockLevel = 'Must be greater than or equal to Reorder Point'
    }

    if (isNaN(safety) || safety < 0) {
      newErrors.safetyStock = 'Must be a non-negative number'
    }

    if (leadTimeDays && (isNaN(leadTime!) || leadTime! < 0)) {
      newErrors.leadTimeDays = 'Must be a non-negative number'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = async () => {
    if (!validate()) {
      toast({
        title: 'Validation Error',
        description: 'Please correct the errors before saving',
        variant: 'destructive'
      })
      return
    }

    try {
      setSaving(true)

      const updates: any = {
        reorder_point: parseInt(reorderPoint),
        reorder_quantity: parseInt(reorderQuantity),
        safety_stock: parseInt(safetyStock),
        updated_at: new Date().toISOString()
      }

      if (maxStockLevel) {
        updates.max_stock_level = parseInt(maxStockLevel)
      } else {
        updates.max_stock_level = null
      }

      if (leadTimeDays) {
        updates.lead_time_days = parseInt(leadTimeDays)
      } else {
        updates.lead_time_days = null
      }

      const { error } = await supabase
        .from('product_inventory')
        .update(updates)
        .eq('id', inventoryItem.id)

      if (error) throw error

      toast({
        title: 'Success',
        description: 'Stock settings updated successfully',
      })

      onSave()
      onClose()
    } catch (error: any) {
      console.error('Error updating stock settings:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to update stock settings',
        variant: 'destructive'
      })
    } finally {
      setSaving(false)
    }
  }

  const getStockStatus = () => {
    const available = inventoryItem.quantity_available
    const reorder = inventoryItem.reorder_point

    if (available <= 0) {
      return { label: 'Out of Stock', color: 'bg-red-500', textColor: 'text-red-700' }
    } else if (available <= reorder * 0.5) {
      return { label: 'Critical', color: 'bg-red-500', textColor: 'text-red-700' }
    } else if (available <= reorder) {
      return { label: 'Low Stock', color: 'bg-orange-500', textColor: 'text-orange-700' }
    } else {
      return { label: 'Healthy', color: 'bg-green-500', textColor: 'text-green-700' }
    }
  }

  const stockStatus = getStockStatus()

  const getStockPercentage = () => {
    const available = inventoryItem.quantity_available
    const max = maxStockLevel ? parseInt(maxStockLevel) : inventoryItem.reorder_point * 3
    return Math.min(100, Math.max(0, (available / max) * 100))
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />

      {/* Panel */}
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-2xl">
          <div className="flex h-full flex-col bg-white shadow-xl">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h2 className="text-xl font-semibold text-white">Inventory Settings</h2>
                  <p className="mt-1 text-sm text-blue-100">
                    Configure stock rules and thresholds
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="ml-3 rounded-md text-blue-100 hover:text-white focus:outline-none focus:ring-2 focus:ring-white"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              {/* Product Info */}
              <div className="mt-4 space-y-1">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-blue-200" />
                  <span className="text-sm font-medium text-white">{inventoryItem.product_name}</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-blue-100">
                  <span className="font-mono">{inventoryItem.variant_code}</span>
                  <span>•</span>
                  <span>{inventoryItem.variant_name}</span>
                </div>
                <div className="text-sm text-blue-100">
                  📍 {inventoryItem.organization_name}
                  {inventoryItem.warehouse_location && ` - ${inventoryItem.warehouse_location}`}
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {/* Current Stock Metrics */}
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                  Current Stock Status
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs text-gray-600 mb-1">On Hand</p>
                    <p className="text-2xl font-bold text-gray-900">{formatNumber(inventoryItem.quantity_on_hand)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs text-gray-600 mb-1">Allocated</p>
                    <p className="text-2xl font-bold text-orange-600">{formatNumber(inventoryItem.quantity_allocated)}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs text-gray-600 mb-1">Available</p>
                    <p className="text-2xl font-bold text-green-600">{formatNumber(inventoryItem.quantity_available)}</p>
                  </div>
                </div>
                {inventoryItem.total_value !== null && (
                  <div className="mt-3 bg-blue-50 rounded-lg p-3 flex items-center justify-between">
                    <span className="text-sm text-blue-900">Total Inventory Value</span>
                    <span className="text-lg font-bold text-blue-900">RM {formatCurrency(inventoryItem.total_value)}</span>
                  </div>
                )}

                {/* Visual Stock Bar */}
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-gray-700">Stock Level</span>
                    <Badge variant={stockStatus.label === 'Healthy' ? 'default' : stockStatus.label === 'Out of Stock' ? 'destructive' : 'outline'}>
                      {stockStatus.label}
                    </Badge>
                  </div>
                  <div className="relative">
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className={`h-3 rounded-full ${stockStatus.color} transition-all duration-300`}
                        style={{ width: `${getStockPercentage()}%` }}
                      />
                    </div>
                    {parseInt(reorderPoint) > 0 && (
                      <div 
                        className="absolute top-0 h-3 w-0.5 bg-red-600"
                        style={{ left: `${Math.min(100, (parseInt(reorderPoint) / (maxStockLevel ? parseInt(maxStockLevel) : inventoryItem.reorder_point * 3)) * 100)}%` }}
                      >
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs text-red-600 whitespace-nowrap">
                          Reorder
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-1 text-xs text-gray-500">
                    <span>0</span>
                    <span>{formatNumber(inventoryItem.quantity_available)} available</span>
                    <span>{maxStockLevel ? formatNumber(parseInt(maxStockLevel)) : 'No max'}</span>
                  </div>
                </div>
              </div>

              {/* Stock Rules Form */}
              <div className="space-y-6">
                <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <Settings className="h-4 w-4 text-blue-600" />
                  Stock Rules Configuration
                </h3>

                {/* Reorder Point */}
                <div>
                  <Label htmlFor="reorderPoint" className="text-sm font-medium text-gray-700">
                    Reorder Point (units) *
                  </Label>
                  <Input
                    id="reorderPoint"
                    type="number"
                    min="0"
                    value={reorderPoint}
                    onChange={(e) => setReorderPoint(e.target.value)}
                    className={errors.reorderPoint ? 'border-red-500' : ''}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Low stock alert triggers when Available ≤ Reorder Point
                  </p>
                  {errors.reorderPoint && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {errors.reorderPoint}
                    </p>
                  )}
                </div>

                {/* Reorder Quantity */}
                <div>
                  <Label htmlFor="reorderQuantity" className="text-sm font-medium text-gray-700">
                    Reorder Quantity (units) *
                  </Label>
                  <Input
                    id="reorderQuantity"
                    type="number"
                    min="0"
                    value={reorderQuantity}
                    onChange={(e) => setReorderQuantity(e.target.value)}
                    className={errors.reorderQuantity ? 'border-red-500' : ''}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Suggested quantity to order when stock is low
                  </p>
                  {errors.reorderQuantity && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {errors.reorderQuantity}
                    </p>
                  )}
                </div>

                {/* Maximum Stock Level */}
                <div>
                  <Label htmlFor="maxStockLevel" className="text-sm font-medium text-gray-700">
                    Maximum Stock Level (units)
                  </Label>
                  <Input
                    id="maxStockLevel"
                    type="number"
                    min="0"
                    value={maxStockLevel}
                    onChange={(e) => setMaxStockLevel(e.target.value)}
                    placeholder="Optional"
                    className={errors.maxStockLevel ? 'border-red-500' : ''}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Upper limit to avoid overstock in this location
                  </p>
                  {errors.maxStockLevel && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {errors.maxStockLevel}
                    </p>
                  )}
                </div>

                {/* Safety Stock */}
                <div>
                  <Label htmlFor="safetyStock" className="text-sm font-medium text-gray-700 flex items-center gap-1">
                    <Shield className="h-4 w-4" />
                    Safety Stock (units)
                  </Label>
                  <Input
                    id="safetyStock"
                    type="number"
                    min="0"
                    value={safetyStock}
                    onChange={(e) => setSafetyStock(e.target.value)}
                    className={errors.safetyStock ? 'border-red-500' : ''}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Buffer stock on top of reorder point for unexpected demand
                  </p>
                  {errors.safetyStock && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {errors.safetyStock}
                    </p>
                  )}
                </div>

                {/* Lead Time */}
                <div>
                  <Label htmlFor="leadTimeDays" className="text-sm font-medium text-gray-700 flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    Lead Time (days)
                  </Label>
                  <Input
                    id="leadTimeDays"
                    type="number"
                    min="0"
                    value={leadTimeDays}
                    onChange={(e) => setLeadTimeDays(e.target.value)}
                    placeholder="Optional"
                    className={errors.leadTimeDays ? 'border-red-500' : ''}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Expected replenishment time for this location and variant
                  </p>
                  {errors.leadTimeDays && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      {errors.leadTimeDays}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-gray-200 px-6 py-4 bg-gray-50">
              <div className="flex justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={onClose}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save Changes
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
