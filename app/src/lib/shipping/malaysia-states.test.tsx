import { describe, expect, it } from 'vitest'
import { toEasyParcelState, toEasyParcelSubdivisionCode } from '@/lib/shipping/malaysia-states'
import { toMalaysiaPhone } from '@/lib/shipping/easyparcel'

describe('malaysia states for EasyParcel OpenAPI', () => {
  it('maps labels and slugs to ISO subdivision codes', () => {
    expect(toEasyParcelSubdivisionCode('Selangor')).toBe('MY-10')
    expect(toEasyParcelSubdivisionCode('selangor')).toBe('MY-10')
    expect(toEasyParcelSubdivisionCode('Kuala Lumpur')).toBe('MY-14')
    expect(toEasyParcelSubdivisionCode('MY-07')).toBe('MY-07')
    expect(toEasyParcelState('Penang')).toBe('penang')
  })
})

describe('Malaysia phone normalisation', () => {
  it('strips country and leading zero', () => {
    expect(toMalaysiaPhone('+60126677889')).toBe('126677889')
    expect(toMalaysiaPhone('012-6677889')).toBe('126677889')
    expect(toMalaysiaPhone('126677889')).toBe('126677889')
  })
})
