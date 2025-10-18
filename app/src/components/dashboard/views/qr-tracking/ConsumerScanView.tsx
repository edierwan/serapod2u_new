'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Scan, Gift, Trophy, Star } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

interface UserProfile {
  id: string
  organizations: { id: string; org_name: string }
}

interface ConsumerScanViewProps {
  userProfile: UserProfile
  onViewChange: (view: string) => void
}

export default function ConsumerScanView({ userProfile, onViewChange }: ConsumerScanViewProps) {
  const [qrCode, setQrCode] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [result, setResult] = useState<any>(null)
  const [scanning, setScanning] = useState(false)
  const { toast } = useToast()

  const handleScan = async () => {
    if (!qrCode || !phone) {
      toast({ title: 'Error', description: 'QR code and phone required', variant: 'destructive' })
      return
    }

    try {
      setScanning(true)
      const response = await fetch('/api/consumer/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qr_code: qrCode,
          consumer_phone: phone,
          consumer_email: email,
          consumer_name: name
        })
      })

      const data = await response.json()
      setResult(data)

      if (data.success) {
        toast({ title: 'Success!', description: `You earned ${data.points_awarded} points!` })
      } else {
        toast({ title: 'Error', description: data.error, variant: 'destructive' })
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' })
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900">Consumer Scan</h1>
        <p className="text-gray-600 mt-1">Scan QR code to earn rewards</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scan className="h-5 w-5" />
            Scan QR Code
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">QR Code</label>
            <input
              type="text"
              value={qrCode}
              onChange={(e) => setQrCode(e.target.value)}
              placeholder="Enter or scan QR code..."
              className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Phone *</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+60123456789"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Name (Optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Email (Optional)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <Button onClick={handleScan} disabled={scanning} className="w-full" size="lg">
            {scanning ? 'Scanning...' : 'Scan & Activate'}
          </Button>
        </CardContent>
      </Card>

      {result && result.success && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <div className="flex items-center justify-center">
                <Star className="h-16 w-16 text-yellow-500" />
              </div>
              <h3 className="text-2xl font-bold text-green-900">Congratulations!</h3>
              
              {result.points_awarded > 0 && (
                <div className="bg-white rounded-lg p-4">
                  <p className="text-sm text-gray-600">Points Earned</p>
                  <p className="text-3xl font-bold text-green-600">+{result.points_awarded}</p>
                  <p className="text-sm text-gray-600 mt-2">
                    Total Balance: {result.points_balance}
                  </p>
                </div>
              )}

              {result.lucky_draw_entry && (
                <div className="bg-white rounded-lg p-4">
                  <Trophy className="h-8 w-8 text-purple-600 mx-auto mb-2" />
                  <p className="text-sm font-medium text-gray-900">Lucky Draw Entry</p>
                  <p className="text-lg font-bold text-purple-600">#{result.lucky_draw_entry.entry_number}</p>
                  <p className="text-sm text-gray-600">{result.lucky_draw_entry.campaign_name}</p>
                </div>
              )}

              {result.redeem_item && (
                <div className="bg-white rounded-lg p-4">
                  <Gift className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                  <p className="text-sm font-medium text-gray-900">Redemption Available</p>
                  <p className="text-lg font-bold text-blue-600">{result.redeem_item.item_name}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
