'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { X, Coins, Trophy, Gift, Shield, User } from 'lucide-react'

interface JourneyConfig {
  id: string
  name: string
  is_default: boolean
  points_enabled: boolean
  lucky_draw_enabled: boolean
  redemption_enabled: boolean
  require_staff_otp_for_points: boolean
  require_customer_otp_for_lucky_draw: boolean
  require_customer_otp_for_redemption: boolean
  start_at: string | null
  end_at: string | null
}

interface JourneyFormModalProps {
  journey?: JourneyConfig | null
  orderId?: string | null
  onClose: () => void
  onSave: () => void
}

export default function JourneyFormModal({ journey, orderId, onClose, onSave }: JourneyFormModalProps) {
  const isEditing = !!journey
  
  const [formData, setFormData] = useState({
    name: journey?.name || '',
    is_default: journey?.is_default || false,
    points_enabled: journey?.points_enabled || false,
    lucky_draw_enabled: journey?.lucky_draw_enabled || false,
    redemption_enabled: journey?.redemption_enabled || false,
    require_staff_otp_for_points: journey?.require_staff_otp_for_points || false,
    require_customer_otp_for_lucky_draw: journey?.require_customer_otp_for_lucky_draw || false,
    require_customer_otp_for_redemption: journey?.require_customer_otp_for_redemption || false,
    start_at: journey?.start_at || '',
    end_at: journey?.end_at || ''
  })
  
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    try {
      const url = isEditing ? '/api/journey/update' : '/api/journey/create'
      const method = isEditing ? 'PATCH' : 'POST'
      
      const payload = isEditing 
        ? { id: journey.id, ...formData }
        : { ...formData, order_id: orderId }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const data = await response.json()

      if (data.success) {
        onSave()
        onClose()
      } else {
        setError(data.error || 'Failed to save journey')
      }
    } catch (err) {
      setError('An error occurred while saving')
      console.error('Error saving journey:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {isEditing ? 'Edit Journey' : 'Create New Journey'}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Configure journey settings and feature toggles
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Basic Info */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Journey Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Premium Product Journey"
                required
                className="mt-1.5"
              />
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <Label htmlFor="is_default" className="font-medium">
                  Set as Default Journey
                </Label>
                <p className="text-sm text-gray-600">
                  Use this journey for orders without a specific journey
                </p>
              </div>
              <Switch
                id="is_default"
                checked={formData.is_default}
                onCheckedChange={(checked) => 
                  setFormData({ ...formData, is_default: checked })
                }
              />
            </div>
          </div>

          {/* Feature Toggles */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Feature Toggles</CardTitle>
              <CardDescription>
                Enable or disable features for this journey
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Points */}
              <div className="flex items-start justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-3">
                  <Coins className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div>
                    <Label className="font-medium text-gray-900">Points System</Label>
                    <p className="text-sm text-gray-600">
                      Award loyalty points to customers
                    </p>
                  </div>
                </div>
                <Switch
                  checked={formData.points_enabled}
                  onCheckedChange={(checked) => 
                    setFormData({ ...formData, points_enabled: checked })
                  }
                />
              </div>

              {/* Lucky Draw */}
              <div className="flex items-start justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-3">
                  <Trophy className="w-5 h-5 text-purple-600 mt-0.5" />
                  <div>
                    <Label className="font-medium text-gray-900">Lucky Draw</Label>
                    <p className="text-sm text-gray-600">
                      Enter customers into lucky draw campaigns
                    </p>
                  </div>
                </div>
                <Switch
                  checked={formData.lucky_draw_enabled}
                  onCheckedChange={(checked) => 
                    setFormData({ ...formData, lucky_draw_enabled: checked })
                  }
                />
              </div>

              {/* Redemption */}
              <div className="flex items-start justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-3">
                  <Gift className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <Label className="font-medium text-gray-900">Redemption</Label>
                    <p className="text-sm text-gray-600">
                      Allow customers to redeem rewards
                    </p>
                  </div>
                </div>
                <Switch
                  checked={formData.redemption_enabled}
                  onCheckedChange={(checked) => 
                    setFormData({ ...formData, redemption_enabled: checked })
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* OTP Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="w-5 h-5" />
                OTP Verification Settings
              </CardTitle>
              <CardDescription>
                Require OTP for additional security
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-600" />
                  <Label className="text-sm font-medium text-blue-900">
                    Staff OTP for Points Award
                  </Label>
                </div>
                <Switch
                  checked={formData.require_staff_otp_for_points}
                  onCheckedChange={(checked) => 
                    setFormData({ ...formData, require_staff_otp_for_points: checked })
                  }
                  disabled={!formData.points_enabled}
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-purple-50 border border-purple-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-purple-600" />
                  <Label className="text-sm font-medium text-purple-900">
                    Customer OTP for Lucky Draw Entry
                  </Label>
                </div>
                <Switch
                  checked={formData.require_customer_otp_for_lucky_draw}
                  onCheckedChange={(checked) => 
                    setFormData({ ...formData, require_customer_otp_for_lucky_draw: checked })
                  }
                  disabled={!formData.lucky_draw_enabled}
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-green-600" />
                  <Label className="text-sm font-medium text-green-900">
                    Customer OTP for Redemption
                  </Label>
                </div>
                <Switch
                  checked={formData.require_customer_otp_for_redemption}
                  onCheckedChange={(checked) => 
                    setFormData({ ...formData, require_customer_otp_for_redemption: checked })
                  }
                  disabled={!formData.redemption_enabled}
                />
              </div>
            </CardContent>
          </Card>

          {/* Time Window */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Time Window (Optional)</CardTitle>
              <CardDescription>
                Restrict this journey to a specific time period
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="start_at">Start Date</Label>
                <Input
                  id="start_at"
                  type="datetime-local"
                  value={formData.start_at}
                  onChange={(e) => setFormData({ ...formData, start_at: e.target.value })}
                  className="mt-1.5"
                />
              </div>

              <div>
                <Label htmlFor="end_at">End Date</Label>
                <Input
                  id="end_at"
                  type="datetime-local"
                  value={formData.end_at}
                  onChange={(e) => setFormData({ ...formData, end_at: e.target.value })}
                  className="mt-1.5"
                />
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : isEditing ? 'Update Journey' : 'Create Journey'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
