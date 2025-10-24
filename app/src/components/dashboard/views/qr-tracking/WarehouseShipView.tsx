'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Truck, Building2, Scan, Gift, Trophy, ShieldCheck, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/ui/use-toast'

interface UserProfile {
  id: string
  email: string
  organization_id: string
  organizations: {
    id: string
    org_name: string
  }
}

interface WarehouseShipViewProps {
  userProfile: UserProfile
  onViewChange: (view: string) => void
}

export default function WarehouseShipView({ userProfile, onViewChange }: WarehouseShipViewProps) {
  const [distributors, setDistributors] = useState<any[]>([])
  const [selectedDistributor, setSelectedDistributor] = useState('')
  const [scannedCodes, setScannedCodes] = useState<any[]>([])
  const [qrInput, setQrInput] = useState('')
  const [redeemItems, setRedeemItems] = useState<any[]>([])
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [selectedRedeem, setSelectedRedeem] = useState('')
  const [selectedCampaign, setSelectedCampaign] = useState('')
  const [shipmentSession, setShipmentSession] = useState<string | null>(null)
  const { toast } = useToast()
  const supabase = createClient()

  useEffect(() => {
    loadDistributors()
    loadRedeemItems()
    loadCampaigns()
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadDistributors = async () => {
    const { data } = await supabase
      .from('organizations')
      .select('*')
      .eq('org_type_code', 'DISTRIBUTOR')
      .eq('is_active', true)
    setDistributors(data || [])
  }

  const loadRedeemItems = async () => {
    const { data } = await supabase
      .from('redeem_items')
      .select('*')
      .eq('is_active', true)
    setRedeemItems(data || [])
  }

  const loadCampaigns = async () => {
    const { data } = await supabase
      .from('lucky_draw_campaigns')
      .select('*')
      .eq('status', 'active')
    setCampaigns(data || [])
  }

  const handleStartShipment = async () => {
    if (!selectedDistributor) {
      toast({ title: 'Error', description: 'Select a distributor', variant: 'destructive' })
      return
    }

    const response = await fetch('/api/warehouse/start-shipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouse_org_id: userProfile.organization_id,
        distributor_org_id: selectedDistributor,
        user_id: userProfile.id
      })
    })

    const result = await response.json()
    setShipmentSession(result.shipment_session_id)
    toast({ title: 'Success', description: 'Shipment session started' })
  }

  const handleScan = async (code: string) => {
    if (!shipmentSession || !code.trim()) return

    const response = await fetch('/api/warehouse/scan-for-shipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shipment_session_id: shipmentSession,
        code: code,
        code_type: code.includes('MASTER') ? 'master' : 'unique'
      })
    })

    const result = await response.json()
    setScannedCodes(prev => [...prev, result])
    setQrInput('')
    toast({ title: 'Success', description: 'Code scanned' })
  }

  const handleCompleteShipment = async () => {
    if (!shipmentSession) return

    const response = await fetch('/api/warehouse/complete-shipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shipment_session_id: shipmentSession,
        approve_discrepancy: true
      })
    })

    toast({ title: 'Success', description: 'Shipment completed' })
    // Reset
    setShipmentSession(null)
    setScannedCodes([])
    setSelectedDistributor('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Warehouse Shipping</h1>
        <p className="text-gray-600 mt-1">Ship products to distributors</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Start Shipment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Distributor
            </label>
            <select
              value={selectedDistributor}
              onChange={(e) => setSelectedDistributor(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              disabled={!!shipmentSession}
            >
              <option value="">Choose distributor...</option>
              {distributors.map(d => (
                <option key={d.id} value={d.id}>{d.org_name}</option>
              ))}
            </select>
          </div>

          {!shipmentSession ? (
            <Button onClick={handleStartShipment} className="w-full">
              Start Shipment Session
            </Button>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Scan QR Codes
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={qrInput}
                    onChange={(e) => setQrInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleScan(qrInput)}
                    placeholder="Scan QR code..."
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg"
                  />
                  <Button onClick={() => handleScan(qrInput)}>
                    <Scan className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Redemption Item
                  </label>
                  <select
                    value={selectedRedeem}
                    onChange={(e) => setSelectedRedeem(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="">None</option>
                    {redeemItems.map(item => (
                      <option key={item.id} value={item.id}>{item.item_name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Lucky Draw Campaign
                  </label>
                  <select
                    value={selectedCampaign}
                    onChange={(e) => setSelectedCampaign(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="">None</option>
                    {campaigns.map(c => (
                      <option key={c.id} value={c.id}>{c.campaign_name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-gray-700">
                  <strong>Scanned:</strong> {scannedCodes.length} codes
                </p>
              </div>

              <Button onClick={handleCompleteShipment} className="w-full" variant="default">
                Complete Shipment
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
