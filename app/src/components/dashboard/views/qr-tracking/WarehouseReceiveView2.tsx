'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle, AlertTriangle, Loader2, Play, Clock, FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'

interface UserProfile {
  id: string
  email: string
  role_code: string
  organization_id: string
  signature_url?: string | null
  organizations: {
    id: string
    org_name: string
    org_type_code: string
  }
  roles: {
    role_level: number
  }
}

interface WarehouseReceiveView2Props {
  userProfile: UserProfile
}

interface BatchProgress {
  batch_id: string
  batch_code: string
  batch_status?: string
  receiving_status?: string
  order_id: string
  order_no: string
  buyer_org_name: string
  total_master_codes: number
  received_master_codes: number
  total_unique_codes: number
  received_unique_codes: number
  master_progress_percentage: number
  unique_progress_percentage: number
  buffer_codes: number
  warranty_bonus_percent: number
}

function CountUp({ value }: { value: number }) {
  const [count, setCount] = useState(value)
  const countRef = useRef(count)

  // Sync ref with state
  useEffect(() => {
    countRef.current = count
  }, [count])

  useEffect(() => {
    const start = countRef.current
    const end = value
    if (start === end) return

    const duration = 1500 // 1.5s animation
    const startTime = Date.now()

    const timer = setInterval(() => {
      const timePassed = Date.now() - startTime
      let progress = timePassed / duration

      if (progress > 1) progress = 1

      // Linear interpolation for "running number" effect
      const current = Math.floor(start + (end - start) * progress)
      setCount(current)

      if (progress === 1) {
        clearInterval(timer)
      }
    }, 20) // 50fps

    return () => clearInterval(timer)
  }, [value])

  return <>{count.toLocaleString()}</>
}

export default function WarehouseReceiveView2({ userProfile }: WarehouseReceiveView2Props) {
  const [orders, setOrders] = useState<any[]>([])
  const [selectedOrder, setSelectedOrder] = useState<string>('')
  const [currentBatch, setCurrentBatch] = useState<BatchProgress | null>(null)
  const [processing, setProcessing] = useState(false)
  const [progressStep, setProgressStep] = useState<'idle' | 'receiving' | 'completed'>('idle')
  const [startTime, setStartTime] = useState<number | null>(null)
  const [elapsedTime, setElapsedTime] = useState<string>('0s')
  const { toast } = useToast()
  const supabase = createClient()

  useEffect(() => {
    if (userProfile?.organization_id) {
      fetchOrders()
    }
  }, [userProfile?.organization_id])

  useEffect(() => {
    let interval: NodeJS.Timeout | undefined
    if (processing && startTime) {
      interval = setInterval(() => {
        const seconds = Math.floor((Date.now() - startTime) / 1000)
        const minutes = Math.floor(seconds / 60)
        const remainingSeconds = seconds % 60
        setElapsedTime(`${minutes}m ${remainingSeconds}s`)
      }, 1000)
    }
    return () => {
      if (interval) {
        clearInterval(interval)
      }
    }
  }, [processing, startTime])

  // Auto-trigger worker in development or if stuck
  useEffect(() => {
    let workerInterval: NodeJS.Timeout | undefined
    if (processing && (currentBatch?.receiving_status === 'queued' || currentBatch?.receiving_status === 'processing')) {
      // Trigger worker every 5 seconds if queued or processing
      workerInterval = setInterval(async () => {
        try {
          console.log('Triggering receiving worker...')
          await fetch('/api/cron/warehouse-receiving-worker')
        } catch (e) {
          console.error('Failed to trigger worker:', e)
        }
      }, 5000)
    }
    return () => {
      if (workerInterval) clearInterval(workerInterval)
    }
  }, [processing, currentBatch?.receiving_status])

  const fetchOrders = async () => {
    console.log('Fetching orders for Warehouse Receive...')

    // Fetch orders that have batches with master codes in 'ready_to_ship' status
    // We might need to filter this more efficiently, but for now let's fetch active orders and filter in JS
    // Assuming warehouse can see all orders or orders related to them. 
    // If this is the main warehouse, they might see all orders.
    
    let query = supabase
      .from('orders')
      .select(`
        id,
        order_no,
        status,
        created_at,
        seller_org_id,
        buyer_org:organizations!orders_buyer_org_id_fkey(org_name),
        seller_org:organizations!orders_seller_org_id_fkey(warranty_bonus),
        qr_batches(id, status)
      `)
      .in('status', ['approved', 'closed']) // Assuming orders are still in these statuses
      .order('created_at', { ascending: false })

    const { data, error } = await query

    if (error) {
      console.error('Error fetching orders:', JSON.stringify(error, null, 2))
      return
    }

    console.log('Raw orders fetched:', data?.length)

    const ordersWithReadyToShipMasters = []
    
    for (const order of data || []) {
      const batches = order.qr_batches as any
      if (!batches) continue
      
      const batchList = Array.isArray(batches) ? batches : [batches]
      if (batchList.length === 0) continue
      
      for (const batch of batchList) {
        // Query master codes for this batch with ready_to_ship status
        const { count: readyCount } = await supabase
          .from('qr_master_codes')
          .select('*', { count: 'exact', head: true })
          .eq('batch_id', batch.id)
          .eq('status', 'ready_to_ship')
        
        if (readyCount && readyCount > 0) {
          ordersWithReadyToShipMasters.push(order)
          break 
        }
      }
    }
    
    console.log('Orders with ready to ship master codes:', ordersWithReadyToShipMasters.length)
    setOrders(ordersWithReadyToShipMasters)
  }

  const handleOrderSelect = async (orderId: string) => {
    setSelectedOrder(orderId)
    const order = orders.find(o => o.id === orderId)
    if (order) {
      const batches = order.qr_batches as any
      const batchList = Array.isArray(batches) ? batches : [batches]
      
      // Find the best batch to show (one that has ready_to_ship codes or is being received)
      // We prioritize batches that are not fully received yet
      const batch = batchList[0] // Simplified for now, ideally check which one has ready_to_ship codes
      
      if (batch) {
        await fetchBatchProgress(batch.id, order)
      }
    }
  }

  const fetchBatchProgress = async (batchId: string, order: any) => {
    // Get latest batch status first
    const { data: batchInfo } = await supabase
      .from('qr_batches')
      .select('status, receiving_status')
      .eq('id', batchId)
      .single()
      
    const batchStatus = batchInfo?.status || 'unknown'
    const receivingStatus = batchInfo?.receiving_status || 'idle'
    const isCompleted = receivingStatus === 'completed'

    // Get counts
    const { count: totalMaster } = await supabase
      .from('qr_master_codes')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batchId)

    let receivedMaster = 0
    if (isCompleted) {
      // If completed, we assume all are received (or at least processed)
      // But to be accurate, let's count 'received_warehouse'
       const { count } = await supabase
        .from('qr_master_codes')
        .select('*', { count: 'exact', head: true })
        .eq('batch_id', batchId)
        .eq('status', 'received_warehouse')
      receivedMaster = count || 0
    } else {
      const { count } = await supabase
        .from('qr_master_codes')
        .select('*', { count: 'exact', head: true })
        .eq('batch_id', batchId)
        .eq('status', 'received_warehouse')
      receivedMaster = count || 0
    }

    const { count: totalUnique } = await supabase
      .from('qr_codes')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batchId)
      .eq('is_buffer', false) // Only count non-buffer codes for main progress

    // Always count received codes for live progress updates
    const { count: receivedCount } = await supabase
      .from('qr_codes')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batchId)
      .eq('status', 'received_warehouse')
      .eq('is_buffer', false) // Only non-buffer codes
    
    const receivedUnique = receivedCount || 0

    const warrantyBonus = (order as any).seller_org?.warranty_bonus || 0

    const batchData: BatchProgress = {
      batch_id: batchId,
      batch_code: `BATCH-${order.order_no}`,
      batch_status: batchStatus,
      receiving_status: receivingStatus,
      order_id: order.id,
      order_no: order.order_no,
      buyer_org_name: order.buyer_org?.org_name || 'Unknown',
      total_master_codes: totalMaster || 0,
      received_master_codes: receivedMaster,
      total_unique_codes: totalUnique || 0,
      received_unique_codes: receivedUnique,
      master_progress_percentage: totalMaster ? (receivedMaster / totalMaster) * 100 : 0,
      unique_progress_percentage: totalUnique ? (receivedUnique / totalUnique) * 100 : 0,
      buffer_codes: Math.floor((totalUnique || 0) * (warrantyBonus / 100)),
      warranty_bonus_percent: warrantyBonus
    }

    setCurrentBatch(batchData)
    
    if (batchData.receiving_status === 'completed') {
        setProgressStep('completed')
    } else if (batchData.receiving_status === 'processing' || batchData.receiving_status === 'queued') {
        setProgressStep('receiving')
        setProcessing(true)
        setStartTime(prev => prev || Date.now())
    } else {
        setProgressStep('idle')
        setProcessing(false)
    }
  }

  const handleCompleteProcess = async () => {
    if (!currentBatch) return

    setProcessing(true)
    setStartTime(Date.now())
    setProgressStep('receiving')

    try {
      // Step 1: Start Receiving Worker
      const startResponse = await fetch('/api/warehouse/start-receiving', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: currentBatch.batch_id })
      })

      if (!startResponse.ok) {
         const errorData = await startResponse.json()
         if (startResponse.status !== 400 && errorData.message !== 'Receiving already in progress') {
             throw new Error(errorData.error || 'Failed to start receiving')
         }
      }

      // Poll for completion
      let isReceiving = true
      let pollCount = 0
      while (isReceiving) {
        // Trigger worker explicitly to ensure it runs
        // For large batches, we call more frequently to keep processing going
        const workerPromise = fetch('/api/cron/warehouse-receiving-worker').catch(e => console.error('Worker trigger failed:', e))
        
        // Wait for worker or timeout (don't block forever)
        await Promise.race([
          workerPromise,
          new Promise(resolve => setTimeout(resolve, 5000)) // 5s timeout
        ])

        await new Promise(resolve => setTimeout(resolve, 1000)) // Brief pause between polls
        
        const order = orders.find(o => o.id === selectedOrder)
        await fetchBatchProgress(currentBatch.batch_id, order)
        
        const { data: checkBatch } = await supabase
            .from('qr_batches')
            .select('receiving_status')
            .eq('id', currentBatch.batch_id)
            .single()
            
        if (checkBatch?.receiving_status === 'completed') {
            isReceiving = false
        } else if (checkBatch?.receiving_status === 'failed') {
            throw new Error('Receiving failed')
        }
        
        pollCount++
        // Log progress every 10 polls for debugging
        if (pollCount % 10 === 0) {
          console.log(`🔄 Still processing... Poll count: ${pollCount}`)
        }
      }

      setProgressStep('completed')
      
      toast({
        title: 'Receiving Complete! 🎉',
        description: `Batch ${currentBatch.batch_code} has been received in warehouse.`,
      })

      // Refresh batch data
      await fetchBatchProgress(currentBatch.batch_id, orders.find(o => o.id === selectedOrder))

      // Refresh orders list to remove completed ones
      await fetchOrders()

    } catch (error: any) {
      console.error('Process failed:', error)
      toast({
        title: 'Process Failed',
        description: error.message,
        variant: 'destructive'
      })
      setProgressStep('idle')
    } finally {
      setProcessing(false)
      setStartTime(null)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Warehouse Receive</h1>
          <p className="text-gray-500 mt-1">Simplified bulk processing for warehouse receiving</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Order to Process</CardTitle>
        </CardHeader>
        <CardContent>
          <select
            className="w-full p-2 border rounded-md"
            value={selectedOrder}
            onChange={(e) => handleOrderSelect(e.target.value)}
            disabled={processing}
          >
            <option value="">Select an order...</option>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.order_no} - {order.buyer_org?.org_name} ({new Date(order.created_at).toLocaleDateString()})
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {currentBatch && (
        <Card>
          <CardHeader>
            <CardTitle className="flex justify-between items-center text-base">
              <span>Batch Progress: {currentBatch.batch_code}</span>
              {processing && (
                <Badge variant="secondary" className="animate-pulse">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Processing... {elapsedTime}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Status Overview */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                <p className="text-xs text-blue-600 font-medium">Master Cases</p>
                <p className="text-lg font-bold text-blue-900">
                  <CountUp value={currentBatch.received_master_codes} /> / {currentBatch.total_master_codes.toLocaleString()}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Progress value={currentBatch.master_progress_percentage} className="h-1.5 flex-1" />
                  <span className="text-xs font-medium text-gray-500 whitespace-nowrap">
                    {Math.round(currentBatch.master_progress_percentage)}%
                  </span>
                </div>
              </div>
              
              <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
                <p className="text-xs text-purple-600 font-medium">Unique Codes</p>
                <p className="text-lg font-bold text-purple-900">
                  <CountUp value={currentBatch.received_unique_codes} /> / {currentBatch.total_unique_codes.toLocaleString()}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Progress value={currentBatch.unique_progress_percentage} className="h-1.5 flex-1" />
                  <span className="text-xs font-medium text-gray-500 whitespace-nowrap">
                    {Math.round(currentBatch.unique_progress_percentage)}%
                  </span>
                </div>
              </div>

              <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                <p className="text-xs text-green-600 font-medium">Warranty Buffer ({currentBatch.warranty_bonus_percent}%)</p>
                <p className="text-lg font-bold text-green-900">
                  <CountUp value={currentBatch.buffer_codes} />
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs font-medium text-gray-500 whitespace-nowrap">
                    Extra {currentBatch.warranty_bonus_percent}% from Manufacturer
                  </span>
                </div>
              </div>

              <div className="p-4 bg-gray-50 rounded-lg border border-gray-100 flex flex-col justify-center items-center">
                <p className="text-xs text-gray-500 font-medium mb-1">Current Status</p>
                <Badge variant={currentBatch.receiving_status === 'completed' ? 'default' : 'outline'} className="text-sm px-3 py-1">
                  {currentBatch.receiving_status || 'idle'}
                </Badge>
              </div>
            </div>

            {/* Action Button */}
            <div className="flex justify-center pt-4">
              {currentBatch.receiving_status === 'completed' ? (
                <div className="text-center space-y-2">
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
                  <p className="text-green-600 font-medium">Receiving Completed</p>
                </div>
              ) : (
                <Button 
                  size="lg" 
                  className="w-full md:w-auto min-w-[200px] bg-blue-600 hover:bg-blue-700"
                  onClick={handleCompleteProcess}
                  disabled={processing}
                >
                  {processing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Receive Order
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
