import { describe, expect, it } from 'vitest'
import { getWhatsAppProviderReadiness } from './whatsapp-provider-readiness'

const base = { id: 'provider-id', isActive: true }

describe('getWhatsAppProviderReadiness', () => {
  it('allows a configured and verified Meta provider without Baileys fields', () => {
    expect(getWhatsAppProviderReadiness({
      ...base,
      providerName: 'whatsapp_business',
      lastTestStatus: 'success',
      publicConfig: { phone_number_id: '123456789' },
      sensitiveConfig: { access_token: 'meta-token' },
    })).toEqual({ eligible: true, reason: null })
  })

  it('rejects an unconfigured Meta provider with a clear reason', () => {
    expect(getWhatsAppProviderReadiness({
      ...base,
      providerName: 'whatsapp_business',
      lastTestStatus: 'success',
      publicConfig: {},
      sensitiveConfig: {},
    })).toEqual({
      eligible: false,
      reason: 'Add and save the Meta Phone Number ID before setting this provider as default.',
    })
  })

  it('requires Meta connection verification', () => {
    expect(getWhatsAppProviderReadiness({
      ...base,
      providerName: 'whatsapp_business',
      lastTestStatus: 'failed',
      publicConfig: { phone_number_id: '123456789' },
      sensitiveConfig: { access_token: 'meta-token' },
    }).reason).toContain('Verify the Meta API connection')
  })

  it('validates Baileys gateway configuration and connection independently', () => {
    expect(getWhatsAppProviderReadiness({
      ...base,
      providerName: 'baileys',
      publicConfig: { base_url: 'https://gateway.local' },
      sensitiveConfig: { api_key: 'key' },
      baileysConnected: true,
    }).eligible).toBe(true)

    expect(getWhatsAppProviderReadiness({
      ...base,
      providerName: 'baileys',
      publicConfig: { base_url: 'https://gateway.local' },
      sensitiveConfig: { api_key: 'key' },
      baileysConnected: false,
    }).reason).toContain('Connect the Baileys WhatsApp session')
  })
})
