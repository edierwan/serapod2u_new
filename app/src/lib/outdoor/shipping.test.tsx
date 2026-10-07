import { describe, expect, it } from 'vitest'
import {
  liveOutdoorShipping,
  outdoorBagWeightKg,
  outdoorCustomerShippingAmount,
  outdoorShippingCustomerSharePercent,
  pickOutdoorShipping,
} from '@/lib/outdoor/shipping'

const rate = { serviceId: 'EP-1', courierName: 'J&T', serviceName: 'Standard', price: 20 }

describe('outdoor live shipping subsidy', () => {
  it('charges the customer 70% of the live rate and records what the company covers', () => {
    expect(liveOutdoorShipping(rate, 90, { freeOver: null })).toMatchObject({
      amount: 14,
      actualCost: 20,
      subsidy: 6,
      title: 'J&T delivery',
      courier: { serviceId: 'EP-1', courierName: 'J&T', serviceName: 'Standard' },
    })
  })

  it('rounds the customer share to sen', () => {
    expect(liveOutdoorShipping({ ...rate, price: 7.35 }, 90, { freeOver: null })).toMatchObject({
      amount: 5.15,
      actualCost: 7.35,
      subsidy: 2.2,
    })
  })

  it('follows a different share and keeps free shipping over the threshold', () => {
    expect(liveOutdoorShipping(rate, 90, { customerSharePercent: 50, freeOver: null }).amount).toBe(10)
    expect(liveOutdoorShipping(rate, 200, { freeOver: 150 })).toMatchObject({ amount: 0, subsidy: 20, title: 'Free shipping' })
  })

  it('reads the share setting safely', () => {
    expect(outdoorShippingCustomerSharePercent(undefined)).toBe(70)
    expect(outdoorShippingCustomerSharePercent('')).toBe(70)
    expect(outdoorShippingCustomerSharePercent('abc')).toBe(70)
    expect(outdoorShippingCustomerSharePercent('120')).toBe(100)
    expect(outdoorShippingCustomerSharePercent('60')).toBe(60)
  })

  it('needs a parcel weight on every product before quoting live', () => {
    expect(outdoorBagWeightKg([{ weightKg: '2.5', quantity: 2 }, { weightKg: 0.4, quantity: 1 }])).toBe(5.4)
    expect(outdoorBagWeightKg([{ weightKg: '2.5', quantity: 1 }, { weightKg: null, quantity: 1 }])).toBeNull()
    expect(outdoorBagWeightKg([])).toBeNull()
  })
})

describe('outdoor customer shipping', () => {
  it('charges the flat rate', () => {
    expect(outdoorCustomerShippingAmount(90)).toBe(2)
  })

  it('shows free shipping once the order reaches the threshold', () => {
    expect(outdoorCustomerShippingAmount(149, { freeOver: 150 })).toBe(2)
    expect(outdoorCustomerShippingAmount(150, { freeOver: 150 })).toBe(0)
  })

  it('uses Standard delivery at RM 2 when the product sets nothing', () => {
    expect(pickOutdoorShipping([{}], 90)).toEqual({
      amount: 2,
      title: 'Standard delivery',
      note: 'One rate for every address in Malaysia. We arrange the courier.',
    })
  })

  it('uses the title, text, and price set on the product', () => {
    expect(
      pickOutdoorShipping(
        [{ outdoor_shipping_title: 'Express', outdoor_shipping_note: 'Two days', outdoor_shipping_price: '8.5' }],
        90,
      ),
    ).toEqual({ amount: 8.5, title: 'Express', note: 'Two days' })
  })

  it('shows Free shipping when the product price is zero', () => {
    expect(pickOutdoorShipping([{ outdoor_shipping_price: 0 }], 90)).toMatchObject({
      amount: 0,
      title: 'Free shipping',
    })
  })

  it('charges the highest delivery price in a mixed bag', () => {
    expect(
      pickOutdoorShipping(
        [
          { outdoor_shipping_price: 0, outdoor_shipping_title: 'Free' },
          { outdoor_shipping_price: 12, outdoor_shipping_title: 'Bulky item' },
          {},
        ],
        200,
      ),
    ).toMatchObject({ amount: 12, title: 'Bulky item' })
  })

  it('switches to free shipping text when the bag reaches the free threshold', () => {
    expect(pickOutdoorShipping([{ outdoor_shipping_title: 'Express', outdoor_shipping_price: 8 }], 200, { freeOver: 150 })).toMatchObject({
      amount: 0,
      title: 'Free shipping',
    })
  })
})
