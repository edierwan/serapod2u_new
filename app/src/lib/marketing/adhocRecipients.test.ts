import { describe, expect, it } from 'vitest'

import {
  normalizeAdhocRecipientList,
  parseAdhocWhatsAppRecipients,
  summarizeAdhocRecipients,
} from '@/lib/marketing/adhocRecipients'

describe('parseAdhocWhatsAppRecipients', () => {
  it('parses space separated numbers into separate eligible recipients', () => {
    const recipients = parseAdhocWhatsAppRecipients('0108870961 01136647708 01139998462')

    expect(recipients.map((recipient) => recipient.phone_normalized)).toEqual([
      '60108870961',
      '601136647708',
      '601139998462',
    ])
    expect(recipients.every((recipient) => recipient.status === 'eligible')).toBe(true)
  })

  it('uses the phone header column when pasting an excel table', () => {
    const recipients = parseAdhocWhatsAppRecipients([
      'Pay Name\tAlias / Match Key\tNo Tipon\tBank\tNo Account\tGrand Tot',
      'MUHAMMAD AMIRUL ASHRAF (MIRUL)\tAMIRUL\t0108870961\tTNG\t152065777914\t245',
      'Farhana\tFARHANA\t019-3792494\tTNG\t170989638203\t580',
      'Sasa\tSASA\t011-61870608\tTNG\t100400039758\t570',
    ].join('\n'))

    expect(recipients).toHaveLength(3)
    expect(recipients.map((recipient) => recipient.phone_normalized)).toEqual([
      '60108870961',
      '60193792494',
      '601161870608',
    ])
    expect(recipients.map((recipient) => recipient.name)).toEqual([
      'MUHAMMAD AMIRUL ASHRAF (MIRUL)',
      'Farhana',
      'Sasa',
    ])
    expect(recipients.every((recipient) => recipient.status === 'eligible')).toBe(true)
  })

  it('marks repeated valid numbers as duplicates', () => {
    const recipients = parseAdhocWhatsAppRecipients('0108870961\n010-8870961\n+60108870961')

    expect(recipients.map((recipient) => ({
      phone: recipient.phone_normalized,
      status: recipient.status,
      reason: recipient.reason,
    }))).toEqual([
      { phone: '60108870961', status: 'eligible', reason: null },
      { phone: '60108870961', status: 'excluded', reason: 'duplicate' },
      { phone: '60108870961', status: 'excluded', reason: 'duplicate' },
    ])
  })

  it('excludes invalid and non-whatsapp values', () => {
    const recipients = parseAdhocWhatsAppRecipients('TNG, PAID, 245, 152065777914')

    expect(recipients.map((recipient) => recipient.reason)).toEqual([
      'invalid_phone',
      'invalid_phone',
      'invalid_phone',
      'not_whatsapp_format',
    ])
    expect(recipients.every((recipient) => recipient.status === 'excluded')).toBe(true)
    expect(summarizeAdhocRecipients(recipients)).toEqual({
      total: 4,
      eligible: 0,
      excluded: 4,
      duplicate: 0,
      invalid: 4,
    })
  })

  it('normalizes stored recipients before reuse', () => {
    const recipients = normalizeAdhocRecipientList([
      { phone_raw: '0108870961', name: 'Mirul' },
      { phone_normalized: '60108870961', display_name: 'Mirul Duplicate' },
      { phone_raw: 'PAID', name: 'Invalid' },
    ])

    expect(recipients.map((recipient) => ({
      status: recipient.status,
      reason: recipient.reason,
      phone: recipient.phone_normalized,
    }))).toEqual([
      { status: 'eligible', reason: null, phone: '60108870961' },
      { status: 'excluded', reason: 'duplicate', phone: '60108870961' },
      { status: 'excluded', reason: 'invalid_phone', phone: null },
    ])
  })
})