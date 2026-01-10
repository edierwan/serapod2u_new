'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import PremiumLoyaltyTemplate from '@/components/journey/templates/PremiumLoyaltyTemplate'

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
  skip_security_code_for_points?: boolean
  skip_security_code_for_lucky_draw?: boolean
  skip_security_code_for_redemption?: boolean
  skip_security_code_for_scratch_card?: boolean
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
  banner_config?: any
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

export default function ConsumerAppPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [journeyConfig, setJourneyConfig] = useState<JourneyConfig | null>(null)
  const [orgId, setOrgId] = useState<string | undefined>(undefined)

  useEffect(() => {
    const fetchDefaultJourney = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch('/api/journey/default')
        const result = await response.json()

        if (!response.ok || !result.success) {
          setError(result.error || 'Failed to load app configuration')
          return
        }

        setJourneyConfig(result.data.journey_config)
        setOrgId(result.data.org_id)
      } catch (err) {
        console.error('Error fetching default journey:', err)
        setError('Failed to connect to server')
      } finally {
        setLoading(false)
      }
    }

    fetchDefaultJourney()
  }, [])

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-500 to-orange-600">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-12 h-12 text-white animate-spin" />
          <p className="text-white font-medium">Loading...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error || !journeyConfig) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">App Not Available</h2>
          <p className="text-gray-600 mb-6">
            {error || 'No loyalty program is currently active. Please try again later.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-orange-500 text-white rounded-xl font-medium hover:bg-orange-600 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  // Render Premium template without QR code context
  // The template will show "Scan to collect" for the Collect button
  return (
    <div className="min-h-screen bg-gray-50">
      <PremiumLoyaltyTemplate
        config={journeyConfig}
        qrCode={undefined} // No QR code - user came directly to /app
        orgId={orgId}
        isLive={true}
        productInfo={undefined}
      />
    </div>
  )
}
