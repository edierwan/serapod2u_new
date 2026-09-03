import { describe, expect, it } from 'vitest'
import {
  STOCK_STRENGTH_UNIT,
  formatStockStrength,
  withStockStrengthUnit,
} from './stock-config-unit-label'

describe('stock configuration strength unit', () => {
  it('renders the stored volume dimension in mg', () => {
    expect(STOCK_STRENGTH_UNIT).toBe('mg')
    expect(formatStockStrength(20)).toBe('20 mg')
    expect(formatStockStrength(50)).toBe('50 mg')
    expect(formatStockStrength('20')).toBe('20 mg')
  })

  it('never renders a bare unit for dimensionless configurations', () => {
    expect(formatStockStrength(null)).toBe('—')
    expect(formatStockStrength(undefined)).toBe('—')
    expect(formatStockStrength('')).toBe('—')
    expect(formatStockStrength('not-a-number')).toBe('—')
    expect(formatStockStrength(null, 'Standard')).toBe('Standard')
  })

  it('rewrites the unit inside stored config labels without touching the rest', () => {
    expect(withStockStrengthUnit('20ml · New Box')).toBe('20 mg · New Box')
    expect(withStockStrengthUnit('50ml New Box')).toBe('50 mg New Box')
    expect(withStockStrengthUnit('50ml Old Box')).toBe('50 mg Old Box')
    expect(withStockStrengthUnit('Legacy / Unclassified')).toBe('Legacy / Unclassified')
  })

  it('passes empty labels straight through so callers can render conditionally', () => {
    expect(withStockStrengthUnit(null)).toBeNull()
    expect(withStockStrengthUnit(undefined)).toBeUndefined()
    expect(withStockStrengthUnit('')).toBe('')
  })
})
