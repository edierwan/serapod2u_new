import { describe, expect, it } from 'vitest'
import { canonicalizeCountedRows, stockCountRowsSignature } from './stock-count-snapshot'

const row = (
  stockConfigId: string,
  variantId: string,
  physicalCount: number | null,
  note = '',
) => ({ stockConfigId, variantId, physicalCount, note })

describe('canonicalizeCountedRows', () => {
  it('drops rows that are neither counted nor noted', () => {
    const result = canonicalizeCountedRows([
      row('20NB', 'v1', 50),
      row('50NB', 'v1', null, '   '),
      row('50OB', 'v1', null, ''),
    ])
    expect(result).toEqual([{ c: '20NB', v: 'v1', p: 50, n: '' }])
  })

  it('keeps a noted-but-uncounted row (a note alone is persisted)', () => {
    const result = canonicalizeCountedRows([row('50OB', 'v1', null, 'damaged box')])
    expect(result).toEqual([{ c: '50OB', v: 'v1', p: null, n: 'damaged box' }])
  })

  it('is order-independent', () => {
    const a = canonicalizeCountedRows([row('50OB', 'v1', 20), row('20NB', 'v1', 50)])
    const b = canonicalizeCountedRows([row('20NB', 'v1', 50), row('50OB', 'v1', 20)])
    expect(a).toEqual(b)
  })
})

describe('stockCountRowsSignature', () => {
  it('is stable regardless of input row order', () => {
    const first = stockCountRowsSignature([
      row('20NB', 'v1', 50),
      row('50NB', 'v1', 50),
      row('50OB', 'v1', 50),
    ])
    const shuffled = stockCountRowsSignature([
      row('50NB', 'v1', 50),
      row('50OB', 'v1', 50),
      row('20NB', 'v1', 50),
    ])
    expect(first).toBe(shuffled)
  })

  it('distinguishes the first import (50/50/50) from the second (50/40/20)', () => {
    // The exact incident: two imports with the same total-shaped grid but
    // different quantities must never collide to the same signature.
    const firstImport = stockCountRowsSignature([
      row('20NB', 'v1', 50),
      row('50NB', 'v1', 50),
      row('50OB', 'v1', 50),
    ])
    const secondImport = stockCountRowsSignature([
      row('20NB', 'v1', 50),
      row('50NB', 'v1', 40),
      row('50OB', 'v1', 20),
    ])
    expect(firstImport).not.toBe(secondImport)
  })

  it('changes when a single physical count changes', () => {
    const before = stockCountRowsSignature([row('20NB', 'v1', 50)])
    const after = stockCountRowsSignature([row('20NB', 'v1', 51)])
    expect(before).not.toBe(after)
  })

  it('distinguishes a blank (not counted) from an explicit zero', () => {
    const blank = stockCountRowsSignature([row('20NB', 'v1', null, 'x')])
    const zero = stockCountRowsSignature([row('20NB', 'v1', 0, 'x')])
    expect(blank).not.toBe(zero)
  })

  it('changes when a note changes', () => {
    const before = stockCountRowsSignature([row('20NB', 'v1', 50, 'first')])
    const after = stockCountRowsSignature([row('20NB', 'v1', 50, 'second')])
    expect(before).not.toBe(after)
  })

  it('matches between a client row set and the equivalent persisted item set', () => {
    // Client-side shape (what saveDraft is about to write)…
    const client = stockCountRowsSignature([
      row('20NB', 'v1', 50, ''),
      row('50NB', 'v1', 40, 'recount'),
    ])
    // …and the persisted-item shape the preflight reconstructs. Parity here is
    // what lets Review & Post detect an unsaved screen.
    const persisted = stockCountRowsSignature([
      { stockConfigId: '50NB', variantId: 'v1', physicalCount: 40, note: 'recount' },
      { stockConfigId: '20NB', variantId: 'v1', physicalCount: 50, note: '' },
    ])
    expect(client).toBe(persisted)
  })
})
