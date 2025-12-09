'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  AlertCircle, 
  CheckCircle2, 
  Smartphone,
  Loader2,
  Shield,
  XCircle
} from 'lucide-react'
import InteractiveMobilePreviewV2 from './InteractiveMobilePreviewV2'
import PremiumLoyaltyTemplate from './templates/PremiumLoyaltyTemplate'

interface JourneyConfig {
  id?: string
  template_type?: 'classic' | 'premium'
  welcome_title: string
  welcome_message: string
  thank_you_message: string
  primary_color: string
  button_color: string
  points_enabled: boolean
  lucky_draw_enabled: boolean
  redemption_enabled: boolean
  enable_scratch_card_game?: boolean
  scratch_card_require_otp?: boolean
  require_security_code?: boolean
  
  // Feature Customization
  points_title?: string | null
  points_description?: string | null
  points_icon?: string
  
  lucky_draw_title?: string
  lucky_draw_description?: string
  lucky_draw_icon?: string
  
  redemption_title?: string
  redemption_description?: string
  redemption_icon?: string
  
  scratch_card_title?: string
  scratch_card_description?: string
  scratch_card_icon?: string

  show_product_image?: boolean
  product_image_source?: 'variant' | 'custom' | 'genuine_badge'
  custom_image_url?: string
  genuine_badge_style?: string
  redemption_requires_login?: boolean
  variant_image_url?: string | null
  lucky_draw_image_url?: string | null
  lucky_draw_campaign_name?: string | null
  lucky_draw_prizes?: any[]
}

interface VerificationData {
  is_valid: boolean
  is_blocked?: boolean // Optional - not in current DB schema
  status?: string
  org_id?: string
  journey_config?: JourneyConfig
  product_info?: {
    product_name?: string
    variant_name?: string
    brand_name?: string
  }
  order_info?: {
    order_no?: string
  }
  message?: string
}

interface PublicJourneyViewProps {
  code: string
  verificationResult: {
    success: boolean
    data?: VerificationData
    error?: string
  }
}

export default function PublicJourneyView({ 
  code, 
  verificationResult 
}: PublicJourneyViewProps) {
  const [isLoading, setIsLoading] = useState(false)
  // Always show full-screen mode for consumers (no phone frame mockup)
  // This eliminates flash and provides better mobile experience
  const fullScreenMode = true

  // Track consumer scan when component mounts (if valid code)
  useEffect(() => {
    const trackConsumerScan = async () => {
      // Only track for valid codes
      if (
        verificationResult.success && 
        verificationResult.data?.is_valid
      ) {
        try {
          await fetch('/api/consumer/track-scan', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              qr_code: code,
              action: 'view_journey', // Consumer viewed the journey builder
            }),
          })
          console.log('Consumer scan tracked successfully')
        } catch (error) {
          console.error('Error tracking consumer scan:', error)
          // Don't block the user experience if tracking fails
        }
      }
    }

    trackConsumerScan()
  }, [code, verificationResult])

  // Handle invalid or blocked codes
  if (!verificationResult.success || verificationResult.error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-gray-50 to-gray-100">
        <Card className="max-w-md w-full shadow-lg">
          <CardHeader className="bg-gradient-to-r from-red-50 to-orange-50 border-b border-red-200">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                <XCircle className="h-7 w-7 text-red-600" />
              </div>
              <div>
                <CardTitle className="text-red-900 text-xl">Product Not Verified</CardTitle>
                <p className="text-sm text-red-600 mt-1">Unable to verify this QR code</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="rounded-lg bg-red-50 border-2 border-red-200 p-4">
              <p className="text-sm font-medium text-red-900 mb-2">
                This product could not be authenticated
              </p>
              <p className="text-xs text-red-700">
                The QR code you scanned is not valid or has not been activated in our system yet.
              </p>
            </div>
            
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4">
              <p className="text-xs font-semibold text-yellow-900 mb-2">⚠️ Caution</p>
              <p className="text-xs text-yellow-800">
                This may indicate a counterfeit product or an inactive QR code. Please contact the seller or manufacturer for verification.
              </p>
            </div>

            <div className="rounded-lg bg-gray-50 p-3 border border-gray-200">
              <p className="text-xs text-gray-500 mb-1">Scanned Code:</p>
              <p className="text-xs text-gray-900 font-mono break-all">{code}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const data = verificationResult.data

  // Handle invalid codes
  // IMPORTANT: Only trust the API's is_valid field, do NOT check status directly
  if (!data?.is_valid) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-gray-50 to-gray-100">
        <Card className="max-w-md w-full shadow-lg">
          <CardHeader className="bg-gradient-to-r from-red-50 to-orange-50 border-b border-red-200">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                <XCircle className="h-7 w-7 text-red-600" />
              </div>
              <div>
                <CardTitle className="text-red-900 text-xl">Product Not Verified</CardTitle>
                <p className="text-sm text-red-600 mt-1">Unable to verify this QR code</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="rounded-lg bg-red-50 border-2 border-red-200 p-4">
              <p className="text-sm font-medium text-red-900 mb-2">
                This product could not be authenticated
              </p>
              <p className="text-xs text-red-700">
                {data?.message || 'The QR code you scanned is not valid or has not been activated in our system yet.'}
              </p>
            </div>
            
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4">
              <p className="text-xs font-semibold text-yellow-900 mb-2">⚠️ Caution</p>
              <p className="text-xs text-yellow-800">
                This may indicate a counterfeit product or an inactive QR code. Please contact the seller or manufacturer for verification.
              </p>
            </div>

            <div className="rounded-lg bg-gray-50 p-3 border border-gray-200">
              <p className="text-xs text-gray-500 mb-1">Scanned Code:</p>
              <p className="text-xs text-gray-900 font-mono break-all">{code}</p>
              {data?.status && (
                <div className="mt-2 pt-2 border-t border-gray-300">
                  <p className="text-xs text-gray-500 mb-1">Current Status:</p>
                  <p className="text-xs text-gray-900 capitalize">{data.status.replace(/_/g, ' ')}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Valid code - Show Journey Builder
  const journeyConfig = data.journey_config || {
    welcome_title: 'Welcome!',
    welcome_message: 'Thank you for scanning this product. This product is genuine and verified.',
    thank_you_message: 'Thank you for your participation!',
    primary_color: '#2563eb',
    button_color: '#3b82f6',
    points_enabled: true,
    lucky_draw_enabled: true,
    redemption_enabled: true,
    enable_scratch_card_game: false,
    scratch_card_require_otp: false,
    show_product_image: true,
    product_image_source: 'genuine_badge',
    genuine_badge_style: 'gold',
    redemption_requires_login: false
  }

  // Use actual journey config values
  const welcomeTitle = journeyConfig.welcome_title || 'Welcome!'
  const welcomeMessage = journeyConfig.welcome_message || 'Thank you for scanning our QR code'

  // Always show full-screen mobile view for consumers (eliminates flash/flicker)
  // Use Premium template if configured, otherwise use Classic
  if (journeyConfig.template_type === 'premium') {
    return (
      <PremiumLoyaltyTemplate 
        config={journeyConfig}
        qrCode={code}
        orgId={data?.org_id}
        isLive={true}
        productInfo={data?.product_info}
      />
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <InteractiveMobilePreviewV2 
        config={journeyConfig} 
        fullScreen={fullScreenMode} 
        qrCode={code} 
        isLive={true}
      />
    </div>
  )
}
