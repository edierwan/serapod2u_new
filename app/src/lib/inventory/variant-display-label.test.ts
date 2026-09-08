import { describe, expect, it } from 'vitest'
import {
  inventoryVariantFilterOption,
  inventoryVariantProductName,
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

describe('View Inventory variant filter options', () => {
  const bananaVanilla = {
    variant_code: 'DEL-150490',
    variant_name: 'Deluxe Cellera Cartridge [ Banana Vanilla ]',
    product_code: 'BV',
    products: { product_name: 'Cellera Hero' },
  }

  it('labels the option with the business identity, not the generated code', () => {
    expect(inventoryVariantFilterOption(bananaVanilla).label)
      .toBe('Cellera Hero / Banana Vanilla – BV')
  })

  it('never shows the generated variant_code in the option text', () => {
    const { label } = inventoryVariantFilterOption(bananaVanilla)
    expect(label).not.toContain('DEL-150490')
    expect(label).not.toContain('[')
  })

  it('keeps the internal variant_code as the value the query filters on', () => {
    expect(inventoryVariantFilterOption(bananaVanilla).value).toBe('DEL-150490')
  })

  it('reads the parent product whichever shape the embed arrives in', () => {
    expect(inventoryVariantProductName(bananaVanilla)).toBe('Cellera Hero')
    expect(inventoryVariantProductName({ products: [{ product_name: 'Fruity Pod' }] }))
      .toBe('Fruity Pod')
    expect(inventoryVariantProductName({ products: null })).toBeNull()
    expect(inventoryVariantProductName(null)).toBeNull()
  })

  it('is not Cellera-specific', () => {
    expect(inventoryVariantFilterOption({
      variant_code: 'FRU-220011',
      variant_name: 'Fruity Cellera Cartridge [ Mango ]',
      product_code: 'MG',
      products: [{ product_name: 'Fruity Cellera' }],
    }).label).toBe('Fruity Cellera / Mango – MG')
  })

  it('degrades to the variant it does know instead of printing undefined', () => {
    expect(inventoryVariantFilterOption({
      variant_code: 'DEL-141367',
      variant_name: 'Deluxe Cellera Cartridge [ Corn ]',
      product_code: null,
      products: null,
    }).label).toBe('Corn')

    const unnamed = inventoryVariantFilterOption({ variant_code: 'DEL-000001' })
    expect(unnamed.label).toBe('No variant')
    expect(unnamed.label).not.toContain('undefined')
    expect(unnamed.value).toBe('DEL-000001')
  })
})
