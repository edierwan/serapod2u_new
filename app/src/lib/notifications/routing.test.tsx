import { describe, expect, it } from 'vitest'
import {
    firstAvailableDeliveryChannel,
    isRoutingFallbackPayload,
    nextFallbackChannels,
    resolveNotificationRoutingPreset,
    shouldAdvanceFallback,
} from './routing'

describe('resolveNotificationRoutingPreset', () => {
    it('honors the saved Email Only preset over legacy channel values', () => {
        expect(resolveNotificationRoutingPreset({
            channels_enabled: ['whatsapp'],
            recipient_config: { routing: { preset: 'email_only' } },
        })).toBe('email_only')
    })

    it('supports legacy channel settings and preserves the WhatsApp default', () => {
        expect(resolveNotificationRoutingPreset({ channels_enabled: ['email'] })).toBe('email_only')
        expect(resolveNotificationRoutingPreset(null)).toBe('whatsapp_only')
    })

    it('can resolve the global default independently of an event override', () => {
        expect(resolveNotificationRoutingPreset({
            recipient_config: { routing: { preset: 'whatsapp_only', default_preset: 'email_only' } },
        }, true)).toBe('email_only')
    })
})

describe('WhatsApp → SMS → Email fallback hops', () => {
    it('advances WhatsApp to SMS, then SMS to Email', () => {
        expect(nextFallbackChannels('whatsapp_sms_email_fallback', 'whatsapp')).toEqual(['sms', 'email'])
        expect(nextFallbackChannels('whatsapp_sms_email_fallback', 'sms')).toEqual(['email'])
        expect(nextFallbackChannels('whatsapp_sms_email_fallback', 'email')).toEqual([])
        expect(nextFallbackChannels('whatsapp_email_fallback', 'whatsapp')).toEqual(['email'])
        expect(nextFallbackChannels('whatsapp_only', 'whatsapp')).toEqual([])
    })

    it('skips a missing first hop when queueing', () => {
        expect(firstAvailableDeliveryChannel('whatsapp_sms_email_fallback', ['sms', 'email'])).toBe('sms')
        expect(firstAvailableDeliveryChannel('whatsapp_sms_email_fallback', ['email'])).toBe('email')
        expect(firstAvailableDeliveryChannel('whatsapp_sms_email_fallback', ['whatsapp', 'sms'])).toBe('whatsapp')
        expect(firstAvailableDeliveryChannel('whatsapp_sms_email_fallback', [])).toBeNull()
    })

    it('advances when the current hop is terminal or the provider is missing', () => {
        expect(shouldAdvanceFallback({ providerMissing: true })).toBe(true)
        expect(shouldAdvanceFallback({ outboxStatus: 'failed', retryCount: 0, maxRetries: 3 })).toBe(true)
        expect(shouldAdvanceFallback({ retryCount: 0, maxRetries: 3 })).toBe(false)
        expect(shouldAdvanceFallback({ retryCount: 2, maxRetries: 3 })).toBe(true)
    })

    it('detects fallback hops so they are not fanned out again', () => {
        expect(isRoutingFallbackPayload({ _routing_fallback_for: 'wa-1' })).toBe(true)
        expect(isRoutingFallbackPayload({ order_no: 'ORD26000060' })).toBe(false)
    })
})
