import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAdminClientMock = vi.fn()
const checkRegistrationAvailabilityMock = vi.fn()
const checkSendRateLimitMock = vi.fn()
const createVerificationCodeMock = vi.fn()
const generateOtpMock = vi.fn()
const hashOtpMock = vi.fn()
const invalidateExistingCodesMock = vi.fn()
const logNotificationEventMock = vi.fn()
const sendOtpViaWhatsAppMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: createAdminClientMock,
}))

vi.mock('@/server/auth/registrationVerificationService', () => ({
  RESEND_COOLDOWN_SECONDS: 60,
  checkRegistrationAvailability: checkRegistrationAvailabilityMock,
  checkSendRateLimit: checkSendRateLimitMock,
  createVerificationCode: createVerificationCodeMock,
  generateOtp: generateOtpMock,
  hashOtp: hashOtpMock,
  invalidateExistingCodes: invalidateExistingCodesMock,
  logNotificationEvent: logNotificationEventMock,
  sendOtpViaWhatsApp: sendOtpViaWhatsAppMock,
}))

describe('POST /api/auth/register/request-code', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    createAdminClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'organizations') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'shop-1',
                    org_name: 'Kedai Maju',
                    branch: 'HQ',
                    org_type_code: 'SHOP',
                    is_active: true,
                  },
                }),
              }),
            }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      },
    })
  })

  it('rejects OTP start when no authoritative shop selection is submitted', async () => {
    const { POST } = await import('./route')

    const response = await POST(new Request('http://localhost/api/auth/register/request-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ali@example.com',
        phone: '0123456789',
        fullName: 'Ali',
        orgId: 'org-1',
        referenceUserId: 'ref-1',
        referralPhone: '+60123456789',
        shopName: 'Kedai Maju',
      }),
    }) as any)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toEqual({
      field: 'shop',
      error: 'Please select a valid shop from the list.',
    })
    expect(checkRegistrationAvailabilityMock).not.toHaveBeenCalled()
    expect(createVerificationCodeMock).not.toHaveBeenCalled()
    expect(sendOtpViaWhatsAppMock).not.toHaveBeenCalled()
  })

  it('rejects OTP start when no authoritative reference selection is submitted', async () => {
    const { POST } = await import('./route')

    const response = await POST(new Request('http://localhost/api/auth/register/request-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ali@example.com',
        phone: '0123456789',
        fullName: 'Ali',
        orgId: 'org-1',
        shopOrganizationId: 'shop-1',
        shopName: 'Kedai Maju (HQ)',
      }),
    }) as any)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toEqual({
      field: 'reference',
      error: 'Please select a valid reference from the list.',
    })
    expect(checkRegistrationAvailabilityMock).not.toHaveBeenCalled()
    expect(createVerificationCodeMock).not.toHaveBeenCalled()
    expect(sendOtpViaWhatsAppMock).not.toHaveBeenCalled()
  })
})