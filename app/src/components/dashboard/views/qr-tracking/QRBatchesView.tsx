'use client'

import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
  QrCode, 
  Download, 
  Plus, 
  Search,
  Filter,
  RefreshCw,
  FileSpreadsheet,
  CheckCircle,
  Clock,
  AlertCircle,
  Package,
  ArrowRight
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'

interface UserProfile {
  id: string
  email: string
  role_code: string
  organization_id: string
  organizations: {
    id: string
    org_name: string
    org_type_code: string
  }
  roles: {
    role_name: string
  }
}

interface QRBatchesViewProps {
  userProfile: UserProfile
  onViewChange: (view: string) => void
}

export default function QRBatchesView({ userProfile, onViewChange }: QRBatchesViewProps) {
  const [batches, setBatches] = useState<any[]>([])
  const [approvedOrders, setApprovedOrders] = useState<any[]>([])
  const [selectedOrderId, setSelectedOrderId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const { toast } = useToast()
  const supabase = createClient()

  useEffect(() => {
    loadBatches()
    loadApprovedOrders()
  // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [])

  const loadApprovedOrders = async () => {
    try {
      // Get approved H2M orders for this manufacturer
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_no,
          order_type,
          status,
          qr_buffer_percent,
          approved_at,
          created_at,
          order_items:order_items(id, qty),
          qr_batches:qr_batches(id, excel_file_url, status)
        `)
        .eq('order_type', 'H2M')
        .in('status', ['approved', 'closed'])
        .eq('seller_org_id', userProfile.organization_id)
        .order('approved_at', { ascending: false })

      if (error) throw error

      console.log('✅ Approved Orders loaded:', data)
      console.log('📊 Total approved orders:', data?.length || 0)
      console.log('🆕 Orders without batches:', data?.filter(o => !o.qr_batches || o.qr_batches.length === 0).length || 0)
      setApprovedOrders(data || [])
    } catch (error: any) {
      console.error('Error loading approved orders:', error)
      toast({
        title: 'Error',
        description: 'Failed to load approved orders',
        variant: 'destructive'
      })
    }
  }

  const loadBatches = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('qr_batches')
        .select(`
          *,
          orders (
            order_no,
            status,
            order_type
          )
        `)
        .eq('company_id', userProfile.organizations.id)
        .order('created_at', { ascending: false })

      if (error) throw error
      setBatches(data || [])
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleOrderSelect = (orderId: string) => {
    setSelectedOrderId(orderId)
  }

  const handleGenerateBatchForSelectedOrder = async () => {
    if (!selectedOrderId) {
      toast({
        title: 'Error',
        description: 'Please select an order first',
        variant: 'destructive'
      })
      return
    }

    await handleGenerateBatch(selectedOrderId)
    setSelectedOrderId('') // Clear selection after generation
  }

  const handleGenerateBatch = async (orderId: string) => {
    try {
      setGenerating(orderId)
      const response = await fetch('/api/qr-batches/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId })
      })

      if (!response.ok) throw new Error('Failed to generate QR batch')
      
      const result = await response.json()
      toast({
        title: 'Success',
        description: `Generated ${result.total_unique_codes} QR codes in ${result.total_master_codes} cases`
      })
      
      await loadBatches()
      await loadApprovedOrders() // Refresh approved orders list
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setGenerating(null)
    }
  }

  const handleRefresh = async () => {
    await Promise.all([loadBatches(), loadApprovedOrders()])
  }

  const handleDownloadExcel = async (batch: any) => {
    try {
      if (!batch.excel_file_url) {
        toast({
          title: 'Error',
          description: 'Excel file not available',
          variant: 'destructive'
        })
        return
      }

      // Download from Supabase Storage
      const response = await fetch(batch.excel_file_url)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `QR_Batch_${batch.id.slice(0, 8)}.xlsx`
      a.click()
      window.URL.revokeObjectURL(url)

      toast({
        title: 'Success',
        description: 'Excel file downloaded'
      })
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    }
  }

  // Get orders that need QR batch generation
  const ordersNeedingBatch = useMemo(() => {
    return approvedOrders.filter(order => !order.qr_batches || order.qr_batches.length === 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps

  }, [approvedOrders])

  const getStatusBadge = (status: string) => {
    const statusConfig: any = {
      pending: { label: 'Pending', variant: 'secondary', icon: Clock },
      generated: { label: 'Generated', variant: 'default', icon: CheckCircle },
      printing: { label: 'Printing', variant: 'default', icon: Clock },
      in_production: { label: 'In Production', variant: 'default', icon: Clock },
      completed: { label: 'Completed', variant: 'default', icon: CheckCircle }
    }
    
    const config = statusConfig[status] || statusConfig.pending
    const Icon = config.icon
    
    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    )
  }

  const filteredBatches = batches.filter(batch => {
    const matchesSearch = !searchTerm || 
      batch.orders?.order_no?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      batch.id.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesStatus = statusFilter === 'all' || batch.status === statusFilter
    
    return matchesSearch && matchesStatus
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">QR Code Batches</h1>
          <p className="text-gray-600 mt-1">
            Manage QR code generation for approved H2M orders
          </p>
        </div>
        <Button onClick={handleRefresh} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <input
                type="text"
                placeholder="Search by order number or batch ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="generated">Generated</option>
              <option value="printing">Printing</option>
              <option value="in_production">In Production</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Approved Orders Section - NEW */}
      {approvedOrders.filter(order => !order.qr_batches || order.qr_batches.length === 0).length > 0 && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-blue-600" />
              Orders Ready for QR Generation
            </CardTitle>
            <CardDescription>
              Select an approved or closed H2M order to generate QR codes and download Excel
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Select Order
                </label>
                <Select value={selectedOrderId} onValueChange={handleOrderSelect}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Choose an approved order..." />
                  </SelectTrigger>
                  <SelectContent>
                    {approvedOrders
                      .filter(order => !order.qr_batches || order.qr_batches.length === 0)
                      .map((order) => {
                        const totalItems = order.order_items?.length || 0
                        const totalQuantity = order.order_items?.reduce((sum: number, item: any) => sum + (item.qty || 0), 0) || 0
                        const qrCodes = Math.ceil(totalQuantity * (1 + (order.qr_buffer_percent || 10) / 100))
                        
                        return (
                          <SelectItem key={order.id} value={order.id}>
                            <div className="flex flex-col">
                              <span className="font-medium">{order.order_no}</span>
                              <span className="text-xs text-gray-500">
                                {totalItems} items • {totalQuantity.toLocaleString()} units • ~{qrCodes.toLocaleString()} QR codes
                              </span>
                            </div>
                          </SelectItem>
                        )
                      })}
                  </SelectContent>
                </Select>
              </div>
              <Button 
                onClick={handleGenerateBatchForSelectedOrder}
                disabled={!selectedOrderId || generating !== null}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {generating === selectedOrderId ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <QrCode className="h-4 w-4 mr-2" />
                    Generate QR Batch & Excel
                  </>
                )}
              </Button>
            </div>

            {/* Order Details Preview */}
            {selectedOrderId && (() => {
              const selectedOrder = approvedOrders.find(o => o.id === selectedOrderId)
              if (!selectedOrder) return null
              
              const totalItems = selectedOrder.order_items?.length || 0
              const totalQuantity = selectedOrder.order_items?.reduce((sum: number, item: any) => sum + (item.qty || 0), 0) || 0
              const bufferPercent = selectedOrder.qr_buffer_percent || 10
              const qrCodes = Math.ceil(totalQuantity * (1 + bufferPercent / 100))
              
              return (
                <div className="bg-white p-4 rounded-lg border border-blue-200">
                  <h4 className="font-medium text-gray-900 mb-3">Order Details</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Order Number</p>
                      <p className="font-medium text-gray-900">{selectedOrder.order_no}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Total Items</p>
                      <p className="font-medium text-gray-900">{totalItems} products</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Total Units</p>
                      <p className="font-medium text-gray-900">{totalQuantity.toLocaleString()} pieces</p>
                    </div>
                    <div>
                      <p className="text-gray-600">QR Codes to Generate</p>
                      <p className="font-medium text-blue-600">{qrCodes.toLocaleString()} (with {bufferPercent}% buffer)</p>
                    </div>
                  </div>
                </div>
              )
            })()}
          </CardContent>
        </Card>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Batches</p>
                <p className="text-2xl font-bold text-gray-900">{batches.length}</p>
              </div>
              <QrCode className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Generated</p>
                <p className="text-2xl font-bold text-green-600">
                  {batches.filter(b => b.status === 'generated').length}
                </p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">In Progress</p>
                <p className="text-2xl font-bold text-orange-600">
                  {batches.filter(b => ['printing', 'in_production'].includes(b.status)).length}
                </p>
              </div>
              <Clock className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Completed</p>
                <p className="text-2xl font-bold text-blue-600">
                  {batches.filter(b => b.status === 'completed').length}
                </p>
              </div>
              <CheckCircle className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Batches List */}
      <Card>
        <CardHeader>
          <CardTitle>QR Batches</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : filteredBatches.length === 0 ? (
            <div className="text-center py-12">
              <QrCode className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No QR batches found</p>
              <p className="text-sm text-gray-500 mt-1">
                Approve H2M orders to generate QR codes
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order No</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Batch ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Master Codes</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unique Codes</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Generated</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredBatches.map((batch) => (
                    <tr key={batch.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900 font-medium">
                        {batch.orders?.order_no || 'N/A'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                        {batch.id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {batch.total_master_codes}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {batch.total_unique_codes}
                      </td>
                      <td className="px-4 py-3">
                        {getStatusBadge(batch.status)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {batch.excel_generated_at 
                          ? new Date(batch.excel_generated_at).toLocaleDateString()
                          : 'Not generated'
                        }
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        {batch.excel_file_url && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownloadExcel(batch)}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            Excel
                          </Button>
                        )}
                        {batch.status === 'pending' && (
                          <Button
                            size="sm"
                            onClick={() => handleGenerateBatch(batch.order_id)}
                            disabled={generating === batch.order_id}
                          >
                            {generating === batch.order_id ? (
                              <>
                                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                                Generating...
                              </>
                            ) : (
                              <>
                                <QrCode className="h-4 w-4 mr-1" />
                                Generate
                              </>
                            )}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
