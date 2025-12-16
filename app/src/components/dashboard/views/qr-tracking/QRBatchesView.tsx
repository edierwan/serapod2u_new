'use client'

import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatNumber } from '@/lib/utils/formatters'
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
  const [workerRunning, setWorkerRunning] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const { toast } = useToast()
  const supabase = createClient()

  useEffect(() => {
    loadBatches()
    loadApprovedOrders()
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll for updates when batches are processing
  useEffect(() => {
    const hasActiveBatches = batches.some(b => ['queued', 'processing'].includes(b.status))
    
    if (hasActiveBatches) {
      const intervalId = setInterval(() => {
        loadBatches(true)
      }, 2000) // Poll every 2 seconds

      return () => clearInterval(intervalId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches])

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
      console.log('🆕 Orders without batches:', data?.filter(o => !o.qr_batches).length || 0)
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

  const loadBatches = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const { data, error } = await supabase
        .from('qr_batches')
        .select(`
          *,
          orders!inner (
            order_no,
            status,
            order_type,
            seller_org_id
          )
        `)
        .eq('orders.seller_org_id', userProfile.organization_id)
        .order('created_at', { ascending: false })

      if (error) throw error
      
      // Fetch packed counts for each batch
      // Progress counts master codes that are packed or beyond (warehouse_packed, ready_to_ship, completed, received_warehouse, shipped_distributor, opened)
      const batchesWithProgress = await Promise.all(
        (data || []).map(async (batch) => {
          const { data: packedData } = await supabase
            .from('qr_master_codes')
            .select('id', { count: 'exact' })
            .eq('batch_id', batch.id)
            .in('status', ['packed', 'warehouse_packed', 'ready_to_ship', 'completed', 'received_warehouse', 'shipped_distributor', 'opened'])
          
          const packedCount = packedData?.length || 0
          const totalCount = batch.total_master_codes || 0
          const progressPercentage = totalCount > 0 ? Math.round((packedCount / totalCount) * 100) : 0
          
          return {
            ...batch,
            packed_master_codes: packedCount,
            progress_percentage: progressPercentage
          }
        })
      )
      
      setBatches(batchesWithProgress)
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      if (!silent) setLoading(false)
    }
  }

  const runWorker = async (showToast = true) => {
    if (workerRunning) return
    
    try {
      setWorkerRunning(true)
      if (showToast) {
        toast({
          title: 'Starting Worker',
          description: 'Triggering background worker...'
        })
      }

      let keepRunning = true
      let runCount = 0
      
      while (keepRunning) {
        runCount++
        const response = await fetch('/api/cron/qr-generation-worker')
        const result = await response.json()
        
        console.log(`Worker run #${runCount} result:`, result)
        
        if (result.message === 'No batches to process') {
          if (showToast && runCount === 1) {
            toast({
              title: 'Worker Idle',
              description: 'No queued batches found to process.'
            })
          }
          keepRunning = false
        } else {
          // If we processed something, refresh the list
          await loadBatches(true)
          
          // Check if we should continue
          // The worker returns hasMore: true if it yielded
          if (result.hasMore) {
             // Add a small delay to prevent hammering
             await new Promise(resolve => setTimeout(resolve, 1000))
          } else {
             keepRunning = false
             if (showToast) {
               toast({
                 title: 'Worker Run Complete',
                 description: 'Batch processing completed.'
               })
             }
          }
        }
      }
    } catch (error: any) {
      console.error('Worker trigger error:', error)
      if (showToast) {
        toast({
          title: 'Worker Error',
          description: 'Failed to trigger worker manually.',
          variant: 'destructive'
        })
      }
    } finally {
      setWorkerRunning(false)
    }
  }

  const handleTriggerWorker = () => runWorker(true)

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
        description: result.message || 'Batch queued for generation'
      })
      
      await loadBatches()
      await loadApprovedOrders() // Refresh approved orders list
      
      // Automatically start the worker
      runWorker(true)
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

      const response = await fetch('/api/qr-batches/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: batch.id })
      })

      const payload = await response.json()

      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || 'Failed to prepare download link')
      }

      // Use direct window.open for better Vercel/production compatibility
      // Signed URLs from Supabase include Content-Disposition header for download
      const downloadUrl = payload.url as string
      
      // Open in new window/tab - browser will handle download automatically
      // This works better on Vercel than anchor.click()
      const downloadWindow = window.open(downloadUrl, '_blank')
      
      // Fallback: if popup blocked, try anchor method
      if (!downloadWindow) {
        const anchor = document.createElement('a')
        anchor.href = downloadUrl
        anchor.target = '_blank'
        anchor.rel = 'noopener noreferrer'
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
      }

      // Check status again to ensure it hasn't changed
      const { data: currentBatch } = await supabase
        .from('qr_batches')
        .select('status')
        .eq('id', batch.id)
        .single()
      
      if (currentBatch?.status !== 'generated') {
        console.warn('Batch status changed, skipping update:', currentBatch?.status)
        return
      }

      // Update batch status to 'printing' after download
      // AND update all QR codes (master + unique) to 'printed' status
      if (batch.status === 'generated') {
        console.log('🔄 Updating batch status via RPC...')
        
        // Use RPC function to update everything in chunks
        // This handles large datasets efficiently with internal batching
        const { data: rpcData, error: rpcError } = await supabase.rpc('mark_batch_as_printed', {
          p_batch_id: batch.id
        })

        if (rpcError) {
          console.error('Failed to update batch status via RPC:', {
            message: rpcError.message,
            code: rpcError.code,
            details: rpcError.details,
            hint: rpcError.hint
          })
          
          // Fallback to client-side chunked updates if RPC fails
          console.warn('⚠️ Falling back to client-side chunked updates...')
          
          // Update batch status first (fast operation)
          const { error: updateError } = await supabase
            .from('qr_batches')
            .update({ 
              status: 'printing',
              updated_at: new Date().toISOString()
            })
            .eq('id', batch.id)

          if (updateError) {
            console.error('Fallback: Failed to update batch:', updateError)
          } else {
            console.log('✅ Batch status updated')
          }

          // Update master codes (typically small number, can do in one go)
          const { error: masterError } = await supabase
            .from('qr_master_codes')
            .update({ 
              status: 'printed',
              updated_at: new Date().toISOString()
            })
            .eq('batch_id', batch.id)
            .eq('status', 'generated')

          if (masterError) {
            console.error('Fallback: Failed to update master codes:', masterError)
          } else {
            console.log('✅ Master codes updated')
          }

          // Update unique codes with optimized chunking
          if (batch.total_unique_codes > 0) {
            const CHUNK_SIZE = 500 // Update 500 codes at a time (safe batch size)
            let totalUpdated = 0
            let chunkIndex = 0
            
            console.log(`Fallback: Updating ${batch.total_unique_codes} unique codes in chunks of ${CHUNK_SIZE}...`)

            // Use limit-offset pagination for reliable chunking
            while (true) {
              const offset = chunkIndex * CHUNK_SIZE
              
              // First, get the IDs of codes to update in this chunk
              const { data: codesToUpdate, error: fetchError } = await supabase
                .from('qr_codes')
                .select('id')
                .eq('batch_id', batch.id)
                .eq('status', 'generated')
                .range(offset, offset + CHUNK_SIZE - 1)

              if (fetchError) {
                console.error(`Fallback: Failed to fetch chunk ${chunkIndex + 1}:`, fetchError)
                break
              }

              if (!codesToUpdate || codesToUpdate.length === 0) {
                console.log(`✅ All unique codes updated (${totalUpdated} total)`)
                break
              }

              // Update this chunk by IDs
              const { error: chunkError, count } = await supabase
                .from('qr_codes')
                .update({ 
                  status: 'printed',
                  updated_at: new Date().toISOString()
                })
                .in('id', codesToUpdate.map(c => c.id))
                .eq('status', 'generated') // Double-check status to avoid race conditions

              if (chunkError) {
                console.error(`Fallback: Failed to update chunk ${chunkIndex + 1} (offset ${offset}):`, chunkError)
                // Continue with next chunk despite error
              } else {
                totalUpdated += codesToUpdate.length
                console.log(`Chunk ${chunkIndex + 1}: Updated ${codesToUpdate.length} codes (${totalUpdated}/${batch.total_unique_codes})`)
              }

              chunkIndex++
              
              // Safety limit: max 1000 chunks (500k codes)
              if (chunkIndex >= 1000) {
                console.warn('Reached maximum chunk limit, stopping updates')
                break
              }
            }
          }
        } else {
          // RPC succeeded, check the response
          if (rpcData?.success) {
            console.log('✅ Batch and codes updated via RPC:', {
              batchUpdated: rpcData.batch_updated,
              masterCodes: rpcData.master_codes_updated,
              uniqueCodes: rpcData.unique_codes_updated
            })
          } else if (rpcData?.error) {
            console.error('RPC returned error:', rpcData.error)
            console.warn('Partial update occurred:', {
              batchUpdated: rpcData.batch_updated,
              masterCodes: rpcData.master_codes_updated,
              uniqueCodes: rpcData.unique_codes_updated
            })
          } else {
            console.log('✅ Batch and codes updated to "printed" via RPC')
          }
        }

        await loadBatches() // Refresh the batches list
      }

      toast({
        title: 'Download Started',
        description: 'Your Excel file is downloading. Please check your browser downloads.'
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
    return approvedOrders.filter(order => {
      // Check if qr_batches is null/undefined OR empty array
      if (!order.qr_batches) return true
      if (Array.isArray(order.qr_batches) && order.qr_batches.length === 0) return true
      return false
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvedOrders])

  const getDuration = (batch: any) => {
    if (!batch.processing_started_at || !batch.processing_finished_at) return null
    
    const start = new Date(batch.processing_started_at).getTime()
    const end = new Date(batch.processing_finished_at).getTime()
    const diff = end - start
    
    if (diff < 0) return null
    
    const minutes = Math.floor(diff / 60000)
    const seconds = Math.floor((diff % 60000) / 1000)
    
    if (minutes === 0) return `${seconds}s`
    return `${minutes}m ${seconds}s`
  }

  const getStatusBadge = (status: string) => {
    const statusConfig: any = {
      queued: { label: 'Queued', variant: 'secondary', icon: Clock },
      processing: { label: 'Processing', variant: 'default', icon: RefreshCw, className: 'animate-spin' },
      failed: { label: 'Failed', variant: 'destructive', icon: AlertCircle },
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
        <Icon className={`h-3 w-3 ${config.className || ''}`} />
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
        <div className="flex gap-2">
          {/* Debug Button for Manual Worker Trigger */}
          <Button 
            onClick={handleTriggerWorker} 
            disabled={workerRunning}
            variant="secondary" 
            className="bg-gray-100 hover:bg-gray-200 text-gray-700"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${workerRunning ? 'animate-spin' : ''}`} />
            {workerRunning ? 'Running...' : 'Run Worker (Debug)'}
          </Button>
          
          <Button onClick={handleRefresh} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
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
      {ordersNeedingBatch.length > 0 && (
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
            <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-end">
              <div className="flex-1">
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Select Order
                </label>
                <Select value={selectedOrderId} onValueChange={handleOrderSelect}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="Choose an approved order..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ordersNeedingBatch
                      .map((order) => {
                        const totalItems = order.order_items?.length || 0
                        const totalQuantity = order.order_items?.reduce((sum: number, item: any) => sum + (item.qty || 0), 0) || 0
                        const bufferQty = Math.floor(totalQuantity * (order.qr_buffer_percent || 10) / 100)
                        const qrCodes = totalQuantity + bufferQty
                        
                        return (
                          <SelectItem key={order.id} value={order.id}>
                            <div className="flex flex-col">
                              <span className="font-medium">{order.order_no}</span>
                              <span className="text-xs text-gray-500">
                                {totalItems} items • {totalQuantity.toLocaleString()} units • {qrCodes.toLocaleString()} QR codes
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
                className="bg-blue-600 hover:bg-blue-700 whitespace-nowrap"
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
              // Fixed calculation: base units + buffer (not multiplied)
              const bufferQty = Math.floor(totalQuantity * bufferPercent / 100)
              const qrCodes = totalQuantity + bufferQty
              
              return (
                <div className="bg-white p-4 rounded-lg border border-blue-200">
                  <h4 className="font-medium text-gray-900 mb-3">Order Details</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 text-sm">
                    <div>
                      <p className="text-gray-600 text-xs sm:text-sm">Order Number</p>
                      <p className="font-medium text-gray-900 truncate">{selectedOrder.order_no}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-xs sm:text-sm">Total Items</p>
                      <p className="font-medium text-gray-900">{totalItems} products</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-xs sm:text-sm">Total Units</p>
                      <p className="font-medium text-gray-900">{totalQuantity.toLocaleString()} pieces</p>
                    </div>
                    <div>
                      <p className="text-gray-600 text-xs sm:text-sm">QR Codes to Generate</p>
                      <p className="font-medium text-blue-600 text-xs sm:text-sm">{qrCodes.toLocaleString()} ({totalQuantity} + {bufferQty} buffer)</p>
                    </div>
                  </div>
                </div>
              )
            })()}
          </CardContent>
        </Card>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card>
          <CardContent className="pt-3 sm:pt-4 lg:pt-6 px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-gray-600">Total Batches</p>
                <p className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900">{batches.length}</p>
              </div>
              <QrCode className="h-6 w-6 sm:h-8 sm:w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 sm:pt-4 lg:pt-6 px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-gray-600">Generated</p>
                <p className="text-lg sm:text-xl lg:text-2xl font-bold text-green-600">
                  {batches.filter(b => ['generated', 'printing'].includes(b.status)).length}
                </p>
              </div>
              <CheckCircle className="h-6 w-6 sm:h-8 sm:w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 sm:pt-4 lg:pt-6 px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-gray-600">In Progress</p>
                <p className="text-lg sm:text-xl lg:text-2xl font-bold text-orange-600">
                  {batches.filter(b => b.status === 'in_production').length}
                </p>
              </div>
              <Clock className="h-6 w-6 sm:h-8 sm:w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 sm:pt-4 lg:pt-6 px-3 sm:px-4 lg:px-6 pb-3 sm:pb-4 lg:pb-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs sm:text-sm text-gray-600">Completed</p>
                <p className="text-lg sm:text-xl lg:text-2xl font-bold text-blue-600">
                  {batches.filter(b => b.status === 'completed').length}
                </p>
              </div>
              <CheckCircle className="h-6 w-6 sm:h-8 sm:w-8 text-blue-600" />
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Progress</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Master Codes</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unique Codes</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredBatches.map((batch) => (
                    <tr key={batch.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900 font-medium">
                        {batch.orders?.order_no || 'N/A'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="relative w-12 h-12">
                            <svg className="w-12 h-12 transform -rotate-90">
                              <circle
                                cx="24"
                                cy="24"
                                r="20"
                                stroke="#E5E7EB"
                                strokeWidth="4"
                                fill="none"
                              />
                              <circle
                                cx="24"
                                cy="24"
                                r="20"
                                stroke={batch.progress_percentage === 100 ? '#10B981' : '#3B82F6'}
                                strokeWidth="4"
                                fill="none"
                                strokeDasharray={`${2 * Math.PI * 20}`}
                                strokeDashoffset={`${2 * Math.PI * 20 * (1 - batch.progress_percentage / 100)}`}
                                strokeLinecap="round"
                              />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xs font-semibold text-gray-700">
                                {batch.progress_percentage}%
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {formatNumber(batch.total_master_codes)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {formatNumber(batch.total_unique_codes)}
                      </td>
                      <td className="px-4 py-3">
                        {batch.status === 'processing' || batch.status === 'queued' ? (
                          <div className="flex flex-col gap-1 min-w-[120px]">
                            <div className="flex items-center justify-between text-xs text-gray-500">
                              <span>{batch.status === 'queued' ? 'Queued' : 'Generating...'}</span>
                              <span>{batch.total_unique_codes > 0 ? Math.round(((batch.qr_inserted_count || 0) / batch.total_unique_codes) * 100) : 0}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-1.5">
                              <div 
                                className="bg-blue-600 h-1.5 rounded-full transition-all duration-500" 
                                style={{ width: `${batch.total_unique_codes > 0 ? Math.round(((batch.qr_inserted_count || 0) / batch.total_unique_codes) * 100) : 0}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-start gap-1">
                            {getStatusBadge(batch.status)}
                            {batch.status === 'completed' && getDuration(batch) && (
                              <span className="text-[10px] text-blue-600 font-medium px-2">
                                {getDuration(batch)}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {new Date(batch.excel_generated_at || batch.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        {batch.excel_file_url && batch.status !== 'processing' && batch.status !== 'queued' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownloadExcel(batch)}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            Excel
                          </Button>
                        )}
                        {(batch.status === 'pending' || batch.status === 'failed') && (
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
                                {batch.status === 'failed' ? 'Retry' : 'Generate'}
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
