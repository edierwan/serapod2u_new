import { describe, expect, it } from 'vitest'
import { billplzSourceString, flattenPaymentParams, verifyBillplzSignature } from './billplz-signature'

describe('billplz x-signature', () => {
  it('matches the official redirect sample', () => {
    const payload = flattenPaymentParams({
      'billplz[id]': 'zq0tm2wc',
      'billplz[paid]': 'true',
      'billplz[paid_at]': '2018-09-27 15:15:09 +0800',
      'billplz[x_signature]': '4aab095fe5a39b1d534500988f9a0cb085cd1b6d5bbb55dd4e02ea6fa102b47b',
      ref: 'ORD-SHOULD-BE-IGNORED',
    })
    expect(billplzSourceString(payload)).toBe(
      'billplzidzq0tm2wc|billplzpaid_at2018-09-27 15:15:09 +0800|billplzpaidtrue',
    )
    expect(
      verifyBillplzSignature(payload, 'S-s7b4yWpp9h7rrkNM1i3Z_g'),
    ).toBe(true)
  })
})
