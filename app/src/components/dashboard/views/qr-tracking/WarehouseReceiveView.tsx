'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Warehouse, 
  Scan, 
  Package,
  CheckCircle,
  TruckIcon,
  RefreshCw,
  AlertCircle
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'

interface UserProfile {
  id: string
  email: string
  organization_id: string
  organizations: {
    id: string
    org_name: string
    org_type_code: string
  }
}

interface WarehouseReceiveViewProps {
  userProfile: UserProfile
  onViewChange: (view: string) => void
}

export default function WarehouseReceiveView({ userProfile, onViewChange }: WarehouseReceiveViewProps) {
  const [masterCodeInput, setMasterCodeInput] = useState('')
  const [receiving, setReceiving] = useState(false)
  const [receivedToday, setReceivedToday] = useState<any[]>([])
  const [pendingBatches, setPendingBatches] = useState<any[]>([])
  const { toast } = useToast()
  const supabase = createClient()

  useEffect(() => {
    loadPendingBatches()
    loadReceivedToday()
  }, [])

  const loadPendingBatches = async () => {
    try {
      const response = await fetch(`/api/warehouse/pending-receives?warehouse_org_id=${userProfile.organization_id}`)
      if (!response.ok) throw new Error('Failed to load pending batches')
      const data = await response.json()
      setPendingBatches(data)
    } catch (error: any) {
      console.error('Error loading pending batches:', error)
    }
  }

  const loadReceivedToday = async () => {
    try {
      const today = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('qr_master_codes')
        .select(`
          *,
          qr_codes (count)
        `)
        .eq('warehouse_org_id', userProfile.organization_id)
        .gte('warehouse_received_at', `${today}T00:00:00`)
        .order('warehouse_received_at', { ascending: false })
        .limit(20)

      if (error) throw error
      setReceivedToday(data || [])
    } catch (error: any) {
      console.error('Error loading received today:', error)
    }
  }

  const handleReceiveMaster = async (code: string) => {
    if (!code.trim()) return

    try {
      setReceiving(true)
      const response = await fetch('/api/warehouse/receive-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          master_code: code,
          warehouse_org_id: userProfile.organization_id,
          user_id: userProfile.id
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to receive master code')
      }

      const result = await response.json()

      toast({
        title: 'Success',
        description: `Received case ${result.case_info.case_number} with ${result.case_info.product_count} products`
      })

      setMasterCodeInput('')
      await loadReceivedToday()
      await loadPendingBatches()
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setReceiving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Warehouse Receive</h1>
        <p className="text-gray-600 mt-1">
          Scan master case codes to receive inventory
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scanning Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scan className="h-5 w-5" />
              Scan Master Case Code
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Master Case QR Code
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={masterCodeInput}
                  onChange={(e) => setMasterCodeInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleReceiveMaster(masterCodeInput)
                    }
                  }}
                  placeholder="Scan master case QR code..."
                  className="flex-1 px-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={receiving}
                  autoFocus
                />
                <Button
                  onClick={() => handleReceiveMaster(masterCodeInput)}
                  disabled={receiving || !masterCodeInput.trim()}
                  size="lg"
                >
                  {receiving ? (
                    <RefreshCw className="h-5 w-5 animate-spin" />
                  ) : (
                    <CheckCircle className="h-5 w-5" />
                  )}
                </Button>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Scan or enter the master case QR code to receive the entire case
              </p>
            </div>

            {/* Instructions */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-900 mb-2">Quick Tips:</h4>
              <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
                <li>Scan only the master case code (not individual units)</li>
                <li>All units in the case will be automatically received</li>
                <li>Inventory will be updated in real-time</li>
                <li>Press Enter or click the button to confirm</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Statistics */}
        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-gray-600">Cases Received</p>
                <p className="text-3xl font-bold text-green-600">{receivedToday.length}</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-gray-600">Total Units</p>
                <p className="text-3xl font-bold text-blue-600">
                  {receivedToday.reduce((sum, item) => sum + (item.actual_unit_count || 0), 0)}
                </p>
              </div>
            </div>

            {/* Recent Receives */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-2">Recent Receives</h4>
              <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
                {receivedToday.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <Package className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                    <p>No cases received today</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {receivedToday.map((item) => (
                      <div key={item.id} className="p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              Case #{item.case_number}
                            </p>
                            <p className="text-xs text-gray-500">
                              {item.actual_unit_count} units
                            </p>
                          </div>
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(item.warehouse_received_at).toLocaleTimeString()}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Batches */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TruckIcon className="h-5 w-5" />
            Pending Receives
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingBatches.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">All batches received!</p>
              <p className="text-sm text-gray-500 mt-1">
                No pending receives at the moment
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order No</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Batch ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Expected Cases</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Received Cases</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pendingBatches.map((batch) => {
                    const progress = batch.expected_cases > 0 
                      ? (batch.received_cases / batch.expected_cases) * 100 
                      : 0
                    
                    return (
                      <tr key={batch.batch_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900 font-medium">
                          {batch.order_no}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                          {batch.batch_id.slice(0, 8)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {batch.expected_cases}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {batch.received_cases}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                              <div 
                                className="bg-blue-600 h-2 rounded-full transition-all"
                                style={{ width: `${progress}%` }}
                              />
                            </div>
                            <span className="text-sm text-gray-600 min-w-[3rem] text-right">
                              {progress.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
