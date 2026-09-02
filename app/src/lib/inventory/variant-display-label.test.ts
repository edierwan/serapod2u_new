import { describe, expect, it } from 'vitest'
import {
  productVariantIdentityLabel,
  variantAlternativeLabel,
  variantFlavourLabel,
  variantFlavourName,
  variantIdentityLabel,
  variantNameWithProductCode,
  variantSelectorLabel,
  variantShortName,
} from './variant-display-label'

describe('View Inventory variant identity line', () => {
  it('reduces the master-data variant name to its flavour, without brackets', () => {
    expect(variantFlavourLabel('Fruity Cellera Cartridge [ Lychee Blackcurrant ]'))
      .toBe('Lychee Blackcurrant')
    expect(variantFlavourLabel('Deluxe Cellera Cartridge [ Banana Vanilla ]'))
      .toBe('Banana Vanilla')
  })

  it('normalizes spacing so every row reads the same way', () => {
    expect(variantFlavourLabel('Fruity Cellera Cartridge [Lychee Blackcurrant]'))
      .toBe('Lychee Blackcurrant')
    expect(variantFlavourLabel('  Fruity Cellera Cartridge [  Corn Vanilla  ]  '))
      .toBe('Corn Vanilla')
  })

  it('keeps variant names that carry no flavour segment as they are', () => {
    expect(variantFlavourLabel('Durian')).toBe('Durian')
    expect(variantFlavourLabel('SERAPOD SONAR NEO')).toBe('SERAPOD SONAR NEO')
  })

  it('falls back to a bracket-free placeholder for missing variant names', () => {
    expect(variantFlavourLabel(null)).toBe('No variant')
    expect(variantFlavourLabel('   ')).toBe('No variant')
    expect(variantFlavourLabel('Cellera Cartridge [  ]')).toBe('No variant')
  })

  it('reads the same whether asked for the flavour label or the flavour name', () => {
    expect(variantFlavourName('Fruity Cellera Cartridge [ Lychee Blackcurrant ]'))
      .toBe('Lychee Blackcurrant')
    expect(variantFlavourName('Durian')).toBe('Durian')
    expect(variantFlavourName(null)).toBe('No variant')
  })

  it('appends the variant Product Code after an en dash', () => {
    expect(variantIdentityLabel('Fruity Cellera Cartridge [ Lychee Blackcurrant ]', 'LB'))
      .toBe('Lychee Blackcurrant – LB')
    expect(variantIdentityLabel('Durian', ' DB ')).toBe('Durian – DB')
  })

  it('omits the separator when the variant has no Product Code', () => {
    expect(variantIdentityLabel('Fruity Cellera Cartridge [ Grape Pudina ]', null))
      .toBe('Grape Pudina')
    expect(variantIdentityLabel('Oxford Blue', '')).toBe('Oxford Blue')
  })

  it('renders the alternative name only when master data carries one', () => {
    expect(variantAlternativeLabel('Banana Milk')).toBe('Alternative: Banana Milk')
    expect(variantAlternativeLabel('  Grape Bubblegum  ')).toBe('Alternative: Grape Bubblegum')
    expect(variantAlternativeLabel(null)).toBeNull()
    expect(variantAlternativeLabel('   ')).toBeNull()
  })
})

describe('combined Product / Variant identity', () => {
  it('renders the agreed "{Product} / {Variant} – {Code}" structure', () => {
    expect(productVariantIdentityLabel('Cellera Hero', 'Deluxe Cellera Cartridge [ Strawberry Corn ]', 'SC'))
      .toBe('Cellera Hero / Strawberry Corn – SC')
    expect(productVariantIdentityLabel('Super Pod V2', 'Classic Mint', 'CM'))
      .toBe('Super Pod V2 / Classic Mint – CM')
  })

  it('carries no square brackets through from master data', () => {
    expect(productVariantIdentityLabel('Cellera Hero', 'Fruity Cellera Cartridge [ Lychee Blackcurrant ]', 'LB'))
      .not.toContain('[')
  })

  it('drops the Product half when master data has no Product Name', () => {
    expect(productVariantIdentityLabel(null, 'Deluxe Cellera Cartridge [ Strawberry Corn ]', 'SC'))
      .toBe('Strawberry Corn – SC')
    expect(productVariantIdentityLabel('  ', 'Classic Mint', null)).toBe('Classic Mint')
  })

  it('drops the variant half when master data has no variant', () => {
    expect(productVariantIdentityLabel('Cellera Hero', null, 'SC')).toBe('Cellera Hero – SC')
    expect(productVariantIdentityLabel('Cellera Hero', '   ', null)).toBe('Cellera Hero')
  })

  it('omits the code when the variant has no Product Code', () => {
    expect(productVariantIdentityLabel('Cellera Hero', 'Deluxe Cellera Cartridge [ Strawberry Corn ]', null))
      .toBe('Cellera Hero / Strawberry Corn')
  })

  it('does not print the same name twice when product and flavour overlap', () => {
    expect(productVariantIdentityLabel('Durian', 'Durian', 'DR')).toBe('Durian – DR')
    expect(productVariantIdentityLabel('Durian', 'Cellera Cartridge [ durian ]', 'DR')).toBe('Durian – DR')
  })

  it('falls back to the placeholder when neither name is known', () => {
    expect(productVariantIdentityLabel(null, null, null)).toBe('No variant')
    expect(productVariantIdentityLabel(null, null, 'SC')).toBe('No variant – SC')
  })
})

describe('administration and picker labels', () => {
  it('keeps the full master-data variant name and joins the code with an en dash', () => {
    expect(variantNameWithProductCode('Deluxe Cellera Cartridge [ Strawberry Corn ]', 'SC'))
      .toBe('Deluxe Cellera Cartridge [ Strawberry Corn ] – SC')
    expect(variantNameWithProductCode('Durian', null)).toBe('Durian')
    expect(variantNameWithProductCode(null, 'SC')).toBe('No variant – SC')
  })

  it('shortens the picker name by dropping packaging words and brackets', () => {
    expect(variantShortName('Deluxe Cellera Cartridge [ Hazelnut ]')).toBe('Deluxe Hazelnut')
    expect(variantShortName('Fruity Cellera Cartridge [ Grape ]')).toBe('Fruity Grape')
    // The range word is what separates two otherwise identical flavours.
    expect(variantShortName('Deluxe Cellera Cartridge [ Hazelnut ]')).toContain('Deluxe')
  })

  it('keeps names the packaging pattern would consume entirely', () => {
    expect(variantShortName('Cellera Cartridge')).toBe('Cellera Cartridge')
    expect(variantShortName(null)).toBe('No variant')
  })

  it('builds the Create Order option text with the attribute and the code', () => {
    expect(variantSelectorLabel('Deluxe Cellera Cartridge [ Hazelnut ]', 'HA', '5%'))
      .toBe('Deluxe Hazelnut (5%) – HA')
    expect(variantSelectorLabel('Deluxe Cellera Cartridge [ Hazelnut ]', 'HA', ''))
      .toBe('Deluxe Hazelnut – HA')
    expect(variantSelectorLabel('Deluxe Cellera Cartridge [ Hazelnut ]', null, null))
      .toBe('Deluxe Hazelnut')
  })
})
