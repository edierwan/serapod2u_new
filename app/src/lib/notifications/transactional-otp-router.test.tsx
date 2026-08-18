import { describe, expect, it } from 'vitest'
import {
  deliveryChainForPreset,
  resolveDeleteUserOtpPreset,
} from '@/lib/notifications/routing'
import {
  resolveOtpChannelContent,
  sendTransactionalOtp,
} from '@/lib/notifications/transactional-otp-router'

const vars = {
  verification_code: '1234',
  target_user_name: 'Allam Salameh',
  requester_email: 'admin@serapod2u.com',
  otp_expiry_minutes: 5,
}

describe('delete_user_otp transactional router (phase 2)', () => {
  it('keeps WhatsApp → SMS → Email when no notification setting exists', () => {
    expect(resolveDeleteUserOtpPreset(null)).toBe('whatsapp_sms_email_fallback')
    expect(deliveryChainForPreset('whatsapp_sms_email_fallback')).toEqual(['whatsapp', 'sms', 'email'])
  })

  it('honors saved single-channel presets', () => {
    expect(resolveDeleteUserOtpPreset({
      recipient_config: { routing: { preset: 'sms_only' } },
    })).toBe('sms_only')
    expect(deliveryChainForPreset('sms_only')).toEqual(['sms'])
    expect(deliveryChainForPreset('email_only')).toEqual(['email'])
    expect(deliveryChainForPreset('whatsapp_only')).toEqual(['whatsapp'])
    expect(deliveryChainForPreset('whatsapp_email_fallback')).toEqual(['whatsapp', 'email'])
  })

  it('does not treat first-hop channels_enabled as the full chain', () => {
    expect(resolveDeleteUserOtpPreset({
      channels_enabled: ['whatsapp'],
      recipient_config: {},
    })).toBe('whatsapp_sms_email_fallback')
  })

  it('renders catalog templates with OTP variables', () => {
    const content = resolveOtpChannelContent('sms', null, vars)
    expect(content.body).toContain('1234')
    expect(content.body).toContain('Allam Salameh')
    expect(content.body).toContain('admin@serapod2u.com')
  })

  it('uses a custom saved template body when provided', () => {
    const content = resolveOtpChannelContent('whatsapp', {
      templates: { whatsapp: 'CODE {{verification_code}} FOR {{target_user_name}}' },
    }, vars)
    expect(content.body).toBe('CODE 1234 FOR Allam Salameh')
  })

  it('falls forward through the chain until a channel succeeds', async () => {
    const attempted: string[] = []
    const result = await sendTransactionalOtp({
      admin: {},
      orgId: 'org-1',
      setting: { recipient_config: { routing: { preset: 'whatsapp_sms_email_fallback' } } },
      phone: '+60123456789',
      email: 'admin@serapod2u.com',
      vars,
      senders: {
        sendWhatsApp: async () => {
          attempted.push('whatsapp')
          throw new Error('Recipient phone number not in allowed list')
        },
        sendSms: async () => {
          attempted.push('sms')
          return { success: true, providerName: 'local_my' }
        },
        sendEmail: async () => {
          attempted.push('email')
          return { success: true, providerName: 'gmail' }
        },
      },
    })

    expect(attempted).toEqual(['whatsapp', 'sms'])
    expect(result.success).toBe(true)
    expect(result.channel).toBe('sms')
    expect(result.fallbackUsed).toBe(true)
    expect(result.errors.whatsapp).toContain('allowed list')
  })

  it('sends SMS only when the saved preset is sms_only', async () => {
    const attempted: string[] = []
    const result = await sendTransactionalOtp({
      admin: {},
      orgId: 'org-1',
      setting: { recipient_config: { routing: { preset: 'sms_only' } } },
      phone: '+60123456789',
      email: 'admin@serapod2u.com',
      vars,
      senders: {
        sendWhatsApp: async () => { attempted.push('whatsapp') },
        sendSms: async () => {
          attempted.push('sms')
          return { success: true, providerName: 'local_my' }
        },
        sendEmail: async () => {
          attempted.push('email')
          return { success: true }
        },
      },
    })

    expect(attempted).toEqual(['sms'])
    expect(result.channel).toBe('sms')
    expect(result.fallbackUsed).toBe(false)
  })
})
