import { describe, expect, it } from 'vitest'
import {
  createRepackPreview,
  isRepackDestinationConfiguration,
  isRepackSourceConfiguration,
} from './repack-stock'
import { resolveStockMovementConfiguration } from './stock-movement-history'

const source = (configId: string, onHand: number, allocated = 0) => ({
  configId,
  onHand,
  allocated,
})

const destination = (onHand: number, allocated = 0) => ({
  configId: '20nb',
  onHand,
  allocated,
})

describe('repack 1:1 balance preview', () => {
  it('converts 10 of 30 50OB units into 20NB', () => {
    expect(createRepackPreview(source('50ob', 30), destination(5), 10)).toMatchObject({
      sourceBefore: 30,
      sourceAfter: 20,
      destinationBefore: 5,
      destinationAfter: 15,
      totalBefore: 35,
      totalAfter: 35,
    })
  })

  it('converts 10 of 40 50NB units into 20NB', () => {
    expect(createRepackPreview(source('50nb', 40), destination(7), 10)).toMatchObject({
      sourceBefore: 40,
      sourceAfter: 30,
      destinationBefore: 7,
      destinationAfter: 17,
      totalBefore: 47,
      totalAfter: 47,
    })
  })

  it('allows the full unallocated quantity', () => {
    expect(createRepackPreview(source('50ob', 30), destination(0), 30)).toMatchObject({
      sourceAfter: 0,
      destinationAfter: 30,
      totalBefore: 30,
      totalAfter: 30,
    })
  })

  it('rejects quantity above available stock', () => {
    expect(() => createRepackPreview(source('50ob', 30), destination(0), 31))
      .toThrow('exceeds available stock (30)')
  })

  it.each([0, -1])('rejects non-positive quantity %s', quantity => {
    expect(() => createRepackPreview(source('50ob', 30), destination(0), quantity))
      .toThrow('positive whole number')
  })

  it('does not convert allocated stock', () => {
    expect(() => createRepackPreview(source('50nb', 40, 35), destination(0), 10))
      .toThrow('exceeds available stock (5)')
  })

  it('rejects the same source and destination configuration', () => {
    expect(() => createRepackPreview(source('20nb', 30), destination(0), 10))
      .toThrow('must differ')
  })

  it('does not mutate unrelated flavour or warehouse balances', () => {
    const unrelated = {
      otherFlavour: source('other-50ob', 88, 3),
      otherWarehouse: source('50ob', 61, 1),
    }
    const snapshot = structuredClone(unrelated)

    createRepackPreview(source('50ob', 30), destination(12), 10)

    expect(unrelated).toEqual(snapshot)
  })

  it('handles zero source available with zero quantity request', () => {
    expect(() => createRepackPreview(source('50ob', 5, 5), destination(10), 1))
      .toThrow('exceeds available stock (0)')
  })

  it('handles large numbers without overflow', () => {
    const result = createRepackPreview(source('50ob', 100000), destination(50000), 50000)
    expect(result.sourceAfter).toBe(50000)
    expect(result.destinationAfter).toBe(100000)
    expect(result.totalAfter).toBe(150000)
  })

  it('returns quantity, sourceAvailable in the result', () => {
    const result = createRepackPreview(source('50nb', 50, 10), destination(20), 5)
    expect(result.quantity).toBe(5)
    expect(result.sourceAvailable).toBe(40)
  })
})

describe('repack configuration eligibility', () => {
  it.each([
    ['50OB', 'old_box'],
    ['50NB', 'new_box'],
  ])('keeps %s as a distinct eligible source', (config_code, packaging) => {
    expect(isRepackSourceConfiguration({
      config_code,
      volume_ml: 50,
      packaging,
      status: config_code === '50OB' ? 'phase_out' : 'active',
    })).toBe(true)
  })

  it('only accepts active 20NB as destination', () => {
    expect(isRepackDestinationConfiguration({
      config_code: '20NB',
      volume_ml: 20,
      packaging: 'new_box',
      status: 'active',
    })).toBe(true)
    expect(isRepackDestinationConfiguration({
      config_code: '50NB',
      volume_ml: 50,
      packaging: 'new_box',
      status: 'active',
    })).toBe(false)
  })

  it('rejects inactive source configurations', () => {
    expect(isRepackSourceConfiguration({
      config_code: '50OB',
      volume_ml: 50,
      packaging: 'old_box',
      status: 'inactive',
    })).toBe(false)
  })

  it('allows phase_out source but not inactive source', () => {
    expect(isRepackSourceConfiguration({
      config_code: '50OB',
      volume_ml: 50,
      packaging: 'old_box',
      status: 'phase_out',
    })).toBe(true)
    expect(isRepackSourceConfiguration({
      config_code: '50OB',
      volume_ml: 50,
      packaging: 'old_box',
      status: 'inactive',
    })).toBe(false)
  })

  it('rejects non-50ml source configurations', () => {
    expect(isRepackSourceConfiguration({
      config_code: '50NB',
      volume_ml: 30,
      packaging: 'new_box',
      status: 'active',
    })).toBe(false)
  })

  it('rejects non-20NB destination configurations', () => {
    expect(isRepackDestinationConfiguration({
      config_code: '20NB',
      volume_ml: 20,
      packaging: 'old_box',
      status: 'active',
    })).toBe(false)
    expect(isRepackDestinationConfiguration({
      config_code: 'STD',
      volume_ml: 20,
      packaging: 'new_box',
      status: 'active',
    })).toBe(false)
  })
})

describe('repack movement audit identity', () => {
  it.each([
    ['50ob', '50OB', '50ml · Old Box'],
    ['50nb', '50NB', '50ml · New Box'],
  ])('shows exact %s source and destination labels under one RPK reference', (sourceId, sourceCode, sourceLabel) => {
    const reference = {
      reference_id: 'repack-request-id',
      reference_no: 'RPK-20260718-0001',
      reference_type: 'repack',
    }
    const outgoing = resolveStockMovementConfiguration(
      { ...reference, movement_type: 'repack_out', stock_config_id: sourceId, quantity_change: -10 },
      { id: sourceId, config_code: sourceCode, config_label: sourceLabel },
    )
    const incoming = resolveStockMovementConfiguration(
      { ...reference, movement_type: 'repack_in', stock_config_id: '20nb', quantity_change: 10 },
      { id: '20nb', config_code: '20NB', config_label: '20ml · New Box' },
    )

    expect([outgoing.reference_no, incoming.reference_no]).toEqual([
      'RPK-20260718-0001',
      'RPK-20260718-0001',
    ])
    expect([outgoing.configuration_display_label, incoming.configuration_display_label]).toEqual([
      sourceLabel,
      '20ml · New Box',
    ])
  })
})