import { describe, expect, it } from 'vitest'
import { outdoorCustomerShippingAmount, pickOutdoorShipping } from '@/lib/outdoor/shipping'

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
