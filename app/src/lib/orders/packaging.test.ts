import { describe, expect, it } from 'vitest'
import {
  casesToPcs,
  DEFAULT_CASES_PER_BOX,
  formatBoxEstimate,
  formatCases,
  formatPackagingLine,
  packagingForTotal,
  resolveCasesPerBox,
  resolvePcsPerCase,
  splitCasesIntoBoxes,
  summarizePackaging,
} from './packaging'

const cellera = { casesPerBox: 100, pcsPerCase: 4 }

describe('packaging sources', () => {
  it('resolves cases per box like Create Order / QR generation (item → order → 100)', () => {
    expect(resolveCasesPerBox(50, 100)).toBe(50)
    expect(resolveCasesPerBox(null, 200)).toBe(200)
    expect(resolveCasesPerBox(undefined, undefined)).toBe(DEFAULT_CASES_PER_BOX)
    expect(resolveCasesPerBox(0, null)).toBe(100)
  })

  it('reuses the central pack-size rule: Cellera = 4 pcs per case', () => {
    expect(resolvePcsPerCase('Cellera Hero', 1)).toBe(4)
    expect(resolvePcsPerCase('Cellera Zero', null)).toBe(4)
    expect(resolvePcsPerCase('Some Device', 12)).toBe(12)
    // Unknown pack size → hidden rather than a misleading "pcs = cases".
    expect(resolvePcsPerCase('Ellbow Cat Treat', 1)).toBeNull()
  })
})

describe('conversions', () => {
  it('4 pcs = 1 case', () => {
    expect(casesToPcs(1, 4)).toBe(4)
    expect(casesToPcs(32000, 4)).toBe(128000)
  })

  it('100 cases = 1 box (400 pcs)', () => {
    expect(splitCasesIntoBoxes(100, 100)).toEqual({ fullBoxes: 1, looseCases: 0 })
    expect(casesToPcs(100, 4)).toBe(400)
    expect(splitCasesIntoBoxes(32000, 100)).toEqual({ fullBoxes: 320, looseCases: 0 })
  })

  it('formats exact and non-exact box estimates', () => {
    expect(formatBoxEstimate(8000, 100)).toBe('80 Boxes')
    expect(formatBoxEstimate(100, 100)).toBe('1 Box')
    expect(formatBoxEstimate(850, 100)).toBe('8 Boxes + 50 Cases')
    expect(formatBoxEstimate(50, 100)).toBe('0 Boxes + 50 Cases')
    expect(formatBoxEstimate(0, 100)).toBe('0 Boxes')
  })

  it('never uses generic "units"', () => {
    expect(formatCases(1)).toBe('1 case')
    expect(formatCases(32000)).toBe('32,000 cases')
    expect(formatPackagingLine(summarizePackaging([{ cases: 300, ...cellera }]))).not.toMatch(/units/i)
  })
})

describe('summarizePackaging', () => {
  it('Total Receive Now: 300 cases • 3 Boxes • 1,200 pcs', () => {
    expect(formatPackagingLine(summarizePackaging([{ cases: 300, ...cellera }]))).toBe('300 cases • 3 Boxes • 1,200 pcs')
  })

  it('zero state: 0 cases • 0 Boxes • 0 pcs', () => {
    expect(formatPackagingLine(summarizePackaging([{ cases: 0, ...cellera }]))).toBe('0 cases • 0 Boxes • 0 pcs')
  })

  it('combines variants that share a box size (Grape 8,000 + Honeydew 6,000 + Guava 4,000)', () => {
    const totals = summarizePackaging([
      { cases: 8000, ...cellera },
      { cases: 6000, ...cellera },
      { cases: 4000, ...cellera },
    ])
    expect(totals).toEqual({ cases: 18000, boxes: { fullBoxes: 180, looseCases: 0 }, pcs: 72000 })
  })

  it('lets loose cases from different variants form boxes when box size matches', () => {
    const totals = summarizePackaging([{ cases: 50, ...cellera }, { cases: 50, ...cellera }])
    expect(totals.boxes).toEqual({ fullBoxes: 1, looseCases: 0 })
  })

  it('splits per line when box sizes differ, and hides pcs if any pack size is unknown', () => {
    const totals = summarizePackaging([
      { cases: 150, casesPerBox: 100, pcsPerCase: 4 },
      { cases: 30, casesPerBox: 20, pcsPerCase: null },
    ])
    expect(totals).toEqual({ cases: 180, boxes: { fullBoxes: 2, looseCases: 60 }, pcs: null })
  })
})

describe('packagingForTotal (receipt summary)', () => {
  it('partial receipt 8,000 of 32,000: received 80 boxes / 32,000 pcs, remaining 240 boxes / 96,000 pcs', () => {
    const lines = [{ cases: 0, ...cellera }]
    const fallback = summarizePackaging(lines)
    expect(packagingForTotal(8000, lines, fallback)).toEqual({ cases: 8000, boxes: { fullBoxes: 80, looseCases: 0 }, pcs: 32000 })
    expect(packagingForTotal(24000, lines, fallback)).toEqual({ cases: 24000, boxes: { fullBoxes: 240, looseCases: 0 }, pcs: 96000 })
    expect(packagingForTotal(32000, lines, fallback).pcs).toBe(128000)
  })

  it('falls back to the per-line breakdown when pack sizes are mixed', () => {
    const lines = [
      { cases: 150, casesPerBox: 100, pcsPerCase: 4 },
      { cases: 30, casesPerBox: 20, pcsPerCase: 4 },
    ]
    const fallback = summarizePackaging(lines)
    expect(packagingForTotal(180, lines, fallback)).toEqual({ ...fallback, cases: 180 })
  })
})
