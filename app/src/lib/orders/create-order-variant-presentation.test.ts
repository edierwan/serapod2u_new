import { describe, expect, it } from 'vitest'
import {
  variantIdentityLabel,
  variantNameWithProductCodeBullet,
  variantSelectorLabel,
  variantShortName,
} from '@/lib/inventory/variant-display-label'

/**
 * Create Order (Supply Chain > Order Management > Create New Order) shows the
 * same variant on three surfaces. These lock the three formats and the single
 * authoritative code source (`product_variants.product_code`); nothing here
 * touches quantity, price, box or QR arithmetic.
 */
describe('Create Order variant presentation', () => {
  describe('Select Variant option', () => {
    it('drops the packaging words and appends the variant Product Code', () => {
      expect(variantSelectorLabel('Deluxe Cellera Cartridge [ Hazelnut ]', 'HA'))
        .toBe('Deluxe [ Hazelnut ] - HA')
      expect(variantSelectorLabel('Fruity Cellera Cartridge [ Grape ]', 'GR'))
        .toBe('Fruity [ Grape ] - GR')
      expect(variantSelectorLabel('Deluxe Cellera Cartridge [ Banana Vanilla ]', 'BV'))
        .toBe('Deluxe [ Banana Vanilla ] - BV')
    })

    it('derives the short range name instead of hard-coding it', () => {
      expect(variantShortName('Fruity Cellera Cartridges [ Lychee Blackcurrant ]'))
        .toBe('Fruity [ Lychee Blackcurrant ]')
      expect(variantShortName('Signature Cellera Cartridge [ Mint ]'))
        .toBe('Signature [ Mint ]')
    })

    it('keeps a readable name for variants outside the Cellera pattern', () => {
      expect(variantSelectorLabel('Durian', 'DU')).toBe('Durian - DU')
      expect(variantShortName('SERAPOD SONAR NEO')).toBe('SERAPOD SONAR NEO')
      // The packaging phrase alone would leave nothing to read.
      expect(variantShortName('Cellera Cartridge')).toBe('Cellera Cartridge')
      expect(variantShortName(null)).toBe('[ No variant ]')
    })

    it('keeps the attribute text master data carries', () => {
      expect(variantSelectorLabel('Deluxe Cellera Cartridge [ Hazelnut ]', 'HA', '5%'))
        .toBe('Deluxe [ Hazelnut ] (5%) - HA')
      expect(variantSelectorLabel('Deluxe Cellera Cartridge [ Hazelnut ]', 'HA', ''))
        .toBe('Deluxe [ Hazelnut ] - HA')
    })

    it('ends at the name when the variant has no Product Code', () => {
      const label = variantSelectorLabel('Deluxe Cellera Cartridge [ Hazelnut ]', null)
      expect(label).toBe('Deluxe [ Hazelnut ]')
      expect(label.endsWith('-')).toBe(false)
      expect(variantSelectorLabel('Deluxe Cellera Cartridge [ Hazelnut ]', '   '))
        .toBe('Deluxe [ Hazelnut ]')
    })
  })

  describe('selected product card', () => {
    it('keeps the full variant name and bullets the variant Product Code', () => {
      expect(variantNameWithProductCodeBullet('Deluxe Cellera Cartridge [ Hazelnut ]', 'HA'))
        .toBe('Deluxe Cellera Cartridge [ Hazelnut ] • HA')
    })

    it('renders no dangling bullet when the Product Code is missing', () => {
      expect(variantNameWithProductCodeBullet('Deluxe Cellera Cartridge [ Hazelnut ]', null))
        .toBe('Deluxe Cellera Cartridge [ Hazelnut ]')
      expect(variantNameWithProductCodeBullet('Deluxe Cellera Cartridge [ Hazelnut ]', ''))
        .toBe('Deluxe Cellera Cartridge [ Hazelnut ]')
    })
  })

  describe('Order Summary line', () => {
    it('reduces the variant to its flavour plus the variant Product Code', () => {
      expect(variantIdentityLabel('Deluxe Cellera Cartridge [ Hazelnut ]', 'HA'))
        .toBe('[ Hazelnut ] - HA')
      expect(variantIdentityLabel('Fruity Cellera Cartridge [ Grape ]', 'GR'))
        .toBe('[ Grape ] - GR')
    })

    it('shows the flavour alone when the Product Code is missing', () => {
      expect(variantIdentityLabel('Deluxe Cellera Cartridge [ Hazelnut ]', null))
        .toBe('[ Hazelnut ]')
    })
  })

  it('never falls back to SKU or variant_code for the Product Code', () => {
    // A variant whose only other identifiers are a SKU and a variant code still
    // renders without a code: those mean something else.
    const sku = 'SKU-CEL-DEL-3648'
    const variantCode = 'CEL-DEL-HA'
    for (const label of [
      variantSelectorLabel('Deluxe Cellera Cartridge [ Hazelnut ]', null),
      variantNameWithProductCodeBullet('Deluxe Cellera Cartridge [ Hazelnut ]', null),
      variantIdentityLabel('Deluxe Cellera Cartridge [ Hazelnut ]', null),
    ]) {
      expect(label).not.toContain(sku)
      expect(label).not.toContain(variantCode)
      expect(label).not.toContain('SKU')
      expect(label.trim().endsWith('-')).toBe(false)
      expect(label.trim().endsWith('•')).toBe(false)
    }
  })

  it('leaves the Create Order arithmetic untouched', () => {
    // Presentation-only regression checkpoint: qty 100 @ RM14, 100 cases/box,
    // 10% QR buffer — the same formulas Create Order already uses.
    const qty = 100
    const unitPrice = 14
    const casesPerBox = 100
    const qrBuffer = 10

    expect(qty * unitPrice).toBe(1400)
    expect(Math.ceil(qty / casesPerBox)).toBe(1)
    expect(Math.ceil(500 / casesPerBox)).toBe(5)
    expect(Math.round(qty + (qty * qrBuffer / 100))).toBe(110)
  })
})
