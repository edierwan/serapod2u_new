import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

import { isEasyParcelBookingEnabled, parseEasyParcelSubmitResponse } from '@/lib/shipping/easyparcel'

describe('isEasyParcelBookingEnabled', () => {
  const env = (value?: string) => ({ OUTDOOR_EASYPARCEL_BOOKING: value }) as unknown as NodeJS.ProcessEnv

  it('keeps EasyParcel to tracking only unless booking is explicitly turned on', () => {
    expect(isEasyParcelBookingEnabled(env())).toBe(false)
    expect(isEasyParcelBookingEnabled(env(''))).toBe(false)
    expect(isEasyParcelBookingEnabled(env('false'))).toBe(false)
    expect(isEasyParcelBookingEnabled(env('true'))).toBe(true)
    expect(isEasyParcelBookingEnabled(env(' ON '))).toBe(true)
  })
})

describe('parseEasyParcelSubmitResponse', () => {
  it('accepts a created shipment even before the AWB is assigned', () => {
    const result = parseEasyParcelSubmitResponse({
      status_code: 200,
      message: '1 requests success, 0 request error.',
      data: [{
        order_details: { order_number: 'EI-2602-4P2SK' },
        shipments: [{ status: 'success', shipment_number: 'ES-2602-4VW9E', awb_number: null }],
      }],
    })
    expect(result).toMatchObject({ ok: true, orderNo: 'EI-2602-4P2SK', awb: null })
  })

  it('returns the AWB when EasyParcel has one', () => {
    const result = parseEasyParcelSubmitResponse({
      data: [{
        order_details: { order_number: 'EI-1' },
        shipments: [{ status: 'success', shipment_number: 'ES-1', awb_number: '7028021894371796' }],
      }],
    })
    expect(result).toMatchObject({ ok: true, awb: '7028021894371796' })
  })

  it('treats an HTTP 200 with a rejected shipment as a failure', () => {
    const result = parseEasyParcelSubmitResponse({
      status_code: 200,
      message: '0 requests success, 1 request error.',
      data: [{ shipments: [{ status: 'error', errors: ['The receiver postcode field is required '] }] }],
    })
    expect(result).toEqual({
      ok: false,
      error: 'EasyParcel did not create the shipment: The receiver postcode field is required',
    })
  })

  it('fails when no shipment comes back at all', () => {
    const result = parseEasyParcelSubmitResponse({ status_code: 200, message: 'Insufficient balance', data: [] })
    expect(result).toEqual({ ok: false, error: 'EasyParcel did not create the shipment: Insufficient balance' })
  })
})
