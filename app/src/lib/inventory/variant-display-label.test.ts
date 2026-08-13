import { describe, expect, it } from 'vitest'
import {
  variantAlternativeLabel,
  variantFlavourLabel,
  variantIdentityLabel,
} from './variant-display-label'

describe('View Inventory variant identity line', () => {
  it('reduces the master-data variant name to its bracketed flavour', () => {
    expect(variantFlavourLabel('Fruity Cellera Cartridge [ Lychee Blackcurrant ]'))
      .toBe('[ Lychee Blackcurrant ]')
    expect(variantFlavourLabel('Deluxe Cellera Cartridge [ Banana Vanilla ]'))
      .toBe('[ Banana Vanilla ]')
  })

  it('normalizes bracket spacing so every row reads the same way', () => {
    expect(variantFlavourLabel('Fruity Cellera Cartridge [Lychee Blackcurrant]'))
      .toBe('[ Lychee Blackcurrant ]')
    expect(variantFlavourLabel('  Fruity Cellera Cartridge [  Corn Vanilla  ]  '))
      .toBe('[ Corn Vanilla ]')
  })

  it('brackets variant names that carry no flavour segment', () => {
    expect(variantFlavourLabel('Durian')).toBe('[ Durian ]')
    expect(variantFlavourLabel('SERAPOD SONAR NEO')).toBe('[ SERAPOD SONAR NEO ]')
  })

  it('falls back to a placeholder for missing or empty variant names', () => {
    expect(variantFlavourLabel(null)).toBe('[ No variant ]')
    expect(variantFlavourLabel('   ')).toBe('[ No variant ]')
    expect(variantFlavourLabel('Cellera Cartridge [  ]')).toBe('[ No variant ]')
  })

  it('appends the variant Product Code from master data', () => {
    expect(variantIdentityLabel('Fruity Cellera Cartridge [ Lychee Blackcurrant ]', 'LB'))
      .toBe('[ Lychee Blackcurrant ] - LB')
    expect(variantIdentityLabel('Durian', ' DB ')).toBe('[ Durian ] - DB')
  })

  it('omits the separator when the variant has no Product Code', () => {
    expect(variantIdentityLabel('Fruity Cellera Cartridge [ Grape Pudina ]', null))
      .toBe('[ Grape Pudina ]')
    expect(variantIdentityLabel('Oxford Blue', '')).toBe('[ Oxford Blue ]')
  })

  it('renders the alternative name only when master data carries one', () => {
    expect(variantAlternativeLabel('Banana Milk')).toBe('Alternative: Banana Milk')
    expect(variantAlternativeLabel('  Grape Bubblegum  ')).toBe('Alternative: Grape Bubblegum')
    expect(variantAlternativeLabel(null)).toBeNull()
    expect(variantAlternativeLabel('   ')).toBeNull()
  })
})
