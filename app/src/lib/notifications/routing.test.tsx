import { describe, expect, it } from 'vitest'
import { resolveNotificationRoutingPreset } from './routing'

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
