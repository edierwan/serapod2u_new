'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Scan, 
  QrCode, 
  Package,
  CheckCircle,
  AlertCircle,
  Trash2,
  Link as LinkIcon,
  RefreshCw
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
}

interface ManufacturerScanViewProps {
  userProfile: UserProfile
  onViewChange: (view: string) => void
}

export default function ManufacturerScanView({ userProfile, onViewChange }: ManufacturerScanViewProps) {
  const [scannedCodes, setScannedCodes] = useState<any[]>([])
  const [masterCode, setMasterCode] = useState('')
  const [qrInput, setQrInput] = useState('')
  const [scanning, setScanning] = useState(false)
  const [linking, setLinking] = useState(false)
  const [batchInfo, setBatchInfo] = useState<any>(null)
  const { toast } = useToast()
  const supabase = createClient()

  const handleScanUnique = async (code: string) => {
    if (!code.trim()) return
    
    try {
      setScanning(true)
      const response = await fetch('/api/manufacturer/scan-unique', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qr_code: code })
      })

      if (!response.ok) throw new Error('Failed to scan QR code')
      
      const result = await response.json()
      
      if (result.already_scanned) {
        toast({
          title: 'Warning',
          description: 'This QR code has already been scanned',
          variant: 'destructive'
        })
        return
      }

      setScannedCodes(prev => [...prev, result.product_info])
      setQrInput('')
      
      toast({
        title: 'Success',
        description: 'QR code scanned successfully'
      })
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setScanning(false)
    }
  }

  const handleLinkToMaster = async () => {
    if (!masterCode.trim() || scannedCodes.length === 0) {
      toast({
        title: 'Error',
        description: 'Please scan master code and at least one unique code',
        variant: 'destructive'
      })
      return
    }

    try {
      setLinking(true)
      const response = await fetch('/api/manufacturer/link-to-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          master_code: masterCode,
          unique_codes: scannedCodes.map(c => c.code),
          manufacturer_org_id: userProfile.organization_id,
          user_id: userProfile.id
        })
      })

      if (!response.ok) throw new Error('Failed to link codes')
      
      const result = await response.json()
      
      toast({
        title: 'Success',
        description: `Linked ${result.linked_count} codes to master case ${result.master_code_info.case_number}`
      })
      
      // Reset
      setScannedCodes([])
      setMasterCode('')
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      })
    } finally {
      setLinking(false)
    }
  }

  const handleRemoveCode = (index: number) => {
    setScannedCodes(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Manufacturer Scan</h1>
        <p className="text-gray-600 mt-1">
          Scan unique QR codes and link them to master case codes
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scanning Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scan className="h-5 w-5" />
              Scan Unique QR Codes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* QR Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Scan/Enter QR Code
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleScanUnique(qrInput)
                    }
                  }}
                  placeholder="Scan or type QR code..."
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={scanning}
                />
                <Button
                  onClick={() => handleScanUnique(qrInput)}
                  disabled={scanning || !qrInput.trim()}
                >
                  {scanning ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Scan className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Scanned Codes List */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">
                  Scanned Codes ({scannedCodes.length})
                </label>
                {scannedCodes.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setScannedCodes([])}
                  >
                    Clear All
                  </Button>
                )}
              </div>
              
              <div className="border border-gray-200 rounded-lg max-h-96 overflow-y-auto">
                {scannedCodes.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    <QrCode className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                    <p>No codes scanned yet</p>
                    <p className="text-sm">Scan QR codes to begin</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {scannedCodes.map((code, index) => (
                      <div key={index} className="p-3 flex items-center justify-between hover:bg-gray-50">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">
                            {code.product_name}
                          </p>
                          <p className="text-xs text-gray-500 font-mono">
                            {code.code}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveCode(index)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Master Code Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Link to Master Case
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Master Code Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Master Case QR Code
              </label>
              <input
                type="text"
                value={masterCode}
                onChange={(e) => setMasterCode(e.target.value)}
                placeholder="Scan master case QR code..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Summary */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Unique Codes:</span>
                <span className="text-sm font-medium text-gray-900">
                  {scannedCodes.length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Master Code:</span>
                <span className="text-sm font-medium text-gray-900">
                  {masterCode || 'Not scanned'}
                </span>
              </div>
            </div>

            {/* Link Button */}
            <Button
              onClick={handleLinkToMaster}
              disabled={linking || scannedCodes.length === 0 || !masterCode}
              className="w-full"
              size="lg"
            >
              {linking ? (
                <>
                  <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
                  Linking...
                </>
              ) : (
                <>
                  <LinkIcon className="h-5 w-5 mr-2" />
                  Link to Master Case
                </>
              )}
            </Button>

            {/* Instructions */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-900 mb-2">Instructions:</h4>
              <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
                <li>Scan all unique QR codes for this case</li>
                <li>Verify the count matches expected units</li>
                <li>Scan the master case QR code</li>
                <li>Click &quot;Link to Master Case&quot; to complete</li>
              </ol>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress Card */}
      {batchInfo && (
        <Card>
          <CardHeader>
            <CardTitle>Batch Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-gray-600">Total Cases</p>
                <p className="text-2xl font-bold text-gray-900">{batchInfo.total_cases}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Packed Cases</p>
                <p className="text-2xl font-bold text-green-600">{batchInfo.packed_cases}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Units</p>
                <p className="text-2xl font-bold text-gray-900">{batchInfo.total_units}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Packed Units</p>
                <p className="text-2xl font-bold text-green-600">{batchInfo.packed_units}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
