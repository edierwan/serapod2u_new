import { describe, expect, it } from 'vitest'
import {
  buildSerappHoldNotes,
  computeSerappHoldExpiry,
  shouldExpireSerappHold,
  SERAPP_HOLD_TTL_MS,
} from './holds'

describe('serapp holds', () => {
  it('computes a 1-hour expiry window', () => {
    const from = new Date('2026-08-05T03:00:00.000Z')
    expect(computeSerappHoldExpiry(from).toISOString()).toBe('2026-08-05T04:00:00.000Z')
    expect(SERAPP_HOLD_TTL_MS).toBe(3_600_000)
  })

  it('expires only active holds past expires_at', () => {
    const now = new Date('2026-08-05T04:00:00.000Z')
    expect(shouldExpireSerappHold({
      status: 'active',
      expires_at: '2026-08-05T03:59:00.000Z',
    }, now)).toBe(true)

    expect(shouldExpireSerappHold({
      status: 'accepted',
      expires_at: '2026-08-05T03:59:00.000Z',
    }, now)).toBe(false)

    expect(shouldExpireSerappHold({
      status: 'active',
      expires_at: '2026-08-05T04:01:00.000Z',
    }, now)).toBe(false)
  })

  it('builds hold notes with Serapp marker', () => {
    const notes = buildSerappHoldNotes({
      orderNo: 'ORD-0805-001',
      warehouseName: 'Main WH',
    })
    expect(notes).toContain('Source: Serapp Conversation')
    expect(notes).toContain('ORD-0805-001')
  })
})
