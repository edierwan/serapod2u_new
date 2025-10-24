/**
 * Journey Configuration Utilities
 * Handles journey resolution, OTP requirements, and feature toggles
 */

import { createClient } from '@/lib/supabase/server'

export interface JourneyConfig {
  id: string
  org_id: string
  name: string
  is_active: boolean
  is_default: boolean
  points_enabled: boolean
  lucky_draw_enabled: boolean
  redemption_enabled: boolean
  require_staff_otp_for_points: boolean
  require_customer_otp_for_lucky_draw: boolean
  require_customer_otp_for_redemption: boolean
  start_at: string | null
  end_at: string | null
  created_at: string
  updated_at: string
}

export interface RedemptionPolicy {
  id: string
  org_id: string
  require_otp_for_redemption: boolean
}

export interface OrgNotificationSettings {
  id: string
  org_id: string
  whatsapp_enabled: boolean
  sms_enabled: boolean
  email_enabled: boolean
}

export type FlowType = 'points' | 'lucky_draw' | 'redemption'

export interface OtpRequirement {
  required: boolean
  reason?: string
  channels: ('whatsapp' | 'sms' | 'email')[]
}

/**
 * Get the effective journey configuration for an order
 * Priority: order-linked journey > default journey > org-level fallback
 */
export async function getEffectiveJourney(
  orderId: string
): Promise<JourneyConfig | null> {
  const supabase = await createClient()

  try {
    // 1. Try to get journey linked to this specific order
    const { data: orderLink, error: linkError } = await supabase
      .from('journey_order_links')
      .select('journey_config_id')
      .eq('order_id', orderId)
      .single()

    if (orderLink && !linkError) {
      const { data: journey, error: journeyError } = await supabase
        .from('journey_configurations')
        .select('*')
        .eq('id', orderLink.journey_config_id)
        .eq('is_active', true)
        .single()

      if (journey && !journeyError) {
        // Check if journey is within valid time window
        if (isJourneyActive(journey)) {
          return journey
        }
      }
    }

    // 2. Get order's org_id to find default journey
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('org_id')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      console.error('Order not found:', orderId)
      return null
    }

    // 3. Try to get default journey for the org
    const { data: defaultJourney, error: defaultError } = await supabase
      .from('journey_configurations')
      .select('*')
      .eq('org_id', order.org_id)
      .eq('is_default', true)
      .eq('is_active', true)
      .single()

    if (defaultJourney && !defaultError) {
      if (isJourneyActive(defaultJourney)) {
        return defaultJourney
      }
    }

    // 4. Fallback: get any active journey for the org
    const { data: anyJourney, error: anyError } = await supabase
      .from('journey_configurations')
      .select('*')
      .eq('org_id', order.org_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (anyJourney && !anyError && isJourneyActive(anyJourney)) {
      return anyJourney
    }

    return null
  } catch (error) {
    console.error('Error getting effective journey:', error)
    return null
  }
}

/**
 * Check if journey is within valid time window
 */
function isJourneyActive(journey: JourneyConfig): boolean {
  const now = new Date()

  if (journey.start_at) {
    const startDate = new Date(journey.start_at)
    if (now < startDate) return false
  }

  if (journey.end_at) {
    const endDate = new Date(journey.end_at)
    if (now > endDate) return false
  }

  return true
}

/**
 * Determine if OTP is required for a specific flow
 * Checks journey config, redemption policy, and org notification settings
 */
export async function needOtp(
  flow: FlowType,
  journeyConfig: JourneyConfig | null,
  orgId: string
): Promise<OtpRequirement> {
  const supabase = await createClient()

  // Get org notification settings to determine available channels
  const { data: orgSettings } = await supabase
    .from('org_notification_settings')
    .select('*')
    .eq('org_id', orgId)
    .single()

  const availableChannels: ('whatsapp' | 'sms' | 'email')[] = []
  if (orgSettings) {
    if (orgSettings.whatsapp_enabled) availableChannels.push('whatsapp')
    if (orgSettings.sms_enabled) availableChannels.push('sms')
    if (orgSettings.email_enabled) availableChannels.push('email')
  }

  // No channels available = no OTP possible
  if (availableChannels.length === 0) {
    return {
      required: false,
      reason: 'No notification channels enabled',
      channels: []
    }
  }

  // Check journey-specific OTP requirements
  if (journeyConfig) {
    switch (flow) {
      case 'points':
        if (journeyConfig.require_staff_otp_for_points) {
          return {
            required: true,
            reason: 'Journey requires staff OTP for points',
            channels: availableChannels
          }
        }
        break

      case 'lucky_draw':
        if (journeyConfig.require_customer_otp_for_lucky_draw) {
          return {
            required: true,
            reason: 'Journey requires customer OTP for lucky draw',
            channels: availableChannels
          }
        }
        break

      case 'redemption':
        if (journeyConfig.require_customer_otp_for_redemption) {
          return {
            required: true,
            reason: 'Journey requires customer OTP for redemption',
            channels: availableChannels
          }
        }
        // Also check redemption policy
        const { data: policy } = await supabase
          .from('redemption_policies')
          .select('*')
          .eq('org_id', orgId)
          .single()

        if (policy?.require_otp_for_redemption) {
          return {
            required: true,
            reason: 'Organization policy requires OTP for redemption',
            channels: availableChannels
          }
        }
        break
    }
  }

  // Default: no OTP required
  return {
    required: false,
    channels: availableChannels
  }
}

/**
 * Check if a feature is enabled in the journey
 */
export function isFeatureEnabled(
  journey: JourneyConfig | null,
  feature: 'points' | 'lucky_draw' | 'redemption'
): boolean {
  if (!journey) return false

  switch (feature) {
    case 'points':
      return journey.points_enabled
    case 'lucky_draw':
      return journey.lucky_draw_enabled
    case 'redemption':
      return journey.redemption_enabled
    default:
      return false
  }
}

/**
 * Error types for journey operations
 */
export class JourneyError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message)
    this.name = 'JourneyError'
  }
}

export const JourneyErrorCodes = {
  OTP_REQUIRED: 'OTP_REQUIRED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  POINTS_DISABLED: 'POINTS_DISABLED',
  LUCKY_DRAW_DISABLED: 'LUCKY_DRAW_DISABLED',
  REDEMPTION_DISABLED: 'REDEMPTION_DISABLED',
  JOURNEY_NOT_FOUND: 'JOURNEY_NOT_FOUND',
  JOURNEY_INACTIVE: 'JOURNEY_INACTIVE',
  JOURNEY_EXPIRED: 'JOURNEY_EXPIRED',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  INVALID_TIME_WINDOW: 'INVALID_TIME_WINDOW'
}
