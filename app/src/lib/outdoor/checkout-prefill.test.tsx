import { describe, expect, it } from 'vitest'
import { outdoorCheckoutPrefill } from '@/lib/outdoor/checkout-prefill'

describe('outdoor checkout prefill', () => {
  it('leaves every field empty when nothing is known', () => {
    expect(outdoorCheckoutPrefill({})).toEqual({
      name: '',
      phone: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postcode: '',
    })
  })

  it('uses the Google name and the saved Outdoor phone and city', () => {
    expect(
      outdoorCheckoutPrefill({
        metadata: { full_name: 'Jafar Ali', outdoor_phone: '0123456789', outdoor_location: 'Shah Alam' },
      }),
    ).toMatchObject({ name: 'Jafar Ali', phone: '0123456789', city: 'Shah Alam', state: '', postcode: '' })
  })

  it('uses the X display name when there is no full name', () => {
    expect(outdoorCheckoutPrefill({ metadata: { name: 'jafar_x' } }).name).toBe('jafar_x')
  })

  it('fills the address from the last order', () => {
    expect(
      outdoorCheckoutPrefill({
        metadata: { full_name: 'Jafar Ali' },
        lastOrder: {
          customer_name: 'Jafar',
          customer_phone: '0111111111',
          shipping_address: { line1: '12 Jalan Satu', line2: 'Unit 3', city: 'Petaling Jaya', state: 'Selangor', postcode: '47301' },
        },
      }),
    ).toEqual({
      name: 'Jafar Ali',
      phone: '0111111111',
      addressLine1: '12 Jalan Satu',
      addressLine2: 'Unit 3',
      city: 'Petaling Jaya',
      state: 'Selangor',
      postcode: '47301',
    })
  })

  it('prefers the profile address over the last order', () => {
    expect(
      outdoorCheckoutPrefill({
        metadata: { full_name: 'Jafar Ali', outdoor_phone: '+6012233445', outdoor_location: 'BUKIT MERTAJAM' },
        profile: {
          full_name: 'Jafar Ali',
          address: '13500, Penang, Permatang Pauh, Jln Pauh Permai\nResidensi Pauh Permai Block A 13 12A',
        },
        lastOrder: {
          customer_phone: '0111111111',
          shipping_address: { line1: 'asdasd', line2: 'asdasd', city: 'asdas', state: 'Selangor', postcode: 'asdasd' },
        },
      }),
    ).toEqual({
      name: 'Jafar Ali',
      phone: '+6012233445',
      addressLine1: '13500, Penang, Permatang Pauh, Jln Pauh Permai',
      addressLine2: 'Residensi Pauh Permai Block A 13 12A',
      city: 'BUKIT MERTAJAM',
      state: 'Penang',
      postcode: '13500',
    })
  })

  it('does not mix the profile address with the last order', () => {
    expect(
      outdoorCheckoutPrefill({
        profile: { address: 'No 5, Jalan Mawar' },
        lastOrder: { shipping_address: { line1: 'Old', city: 'Klang', state: 'Selangor', postcode: '41000' } },
      }),
    ).toMatchObject({ addressLine1: 'No 5, Jalan Mawar', addressLine2: '', city: '', state: '', postcode: '' })
  })

  it('reads common state spellings from the profile address', () => {
    expect(outdoorCheckoutPrefill({ profile: { address: '10 Lebuh Pantai, 10300 Pulau Pinang' } })).toMatchObject({
      state: 'Penang',
      postcode: '10300',
    })
  })

  it('ignores a state that is not in Malaysia', () => {
    expect(
      outdoorCheckoutPrefill({ lastOrder: { shipping_address: { line1: 'A', state: 'Texas' } } }).state,
    ).toBe('')
  })
})
