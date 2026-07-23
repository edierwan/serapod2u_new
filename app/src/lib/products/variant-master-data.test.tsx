import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  VARIANT_MASTER_DATA_HEADERS,
  buildVariantMasterDataWorkbook,
  getVariantFlavour,
  matchesVariantSearch,
} from './variant-master-data'

const banana = {
  variant_name: 'Deluxe Cellera Cartridge [ Banana Milk ]',
  alternative_name: 'Banana Vanilla',
  product_code: 'BV',
  barcode: 'CELDE96787',
  manufacturer_sku: 'SKU-CEL-DEL-6787',
}

describe('matchesVariantSearch', () => {
  it.each(['banana', 'banana milk', 'banana vanilla', 'vanilla', 'BV', 'celde96787', 'sku-cel'])('matches %s', (search) => {
    expect(matchesVariantSearch(banana, search)).toBe(true)
  })

  it('is case-insensitive and trims the query', () => {
    expect(matchesVariantSearch(banana, '  BANANA VANILLA  ')).toBe(true)
  })

  it('does not match unrelated text', () => {
    expect(matchesVariantSearch(banana, 'strawberry')).toBe(false)
  })
})

describe('variant master data export', () => {
  it('extracts the clean bracketed flavour', () => {
    expect(getVariantFlavour(banana.variant_name)).toBe('Banana Milk')
    expect(getVariantFlavour('Plain Flavour')).toBe('Plain Flavour')
  })

  it('builds a valid workbook with exactly the required columns and text values', async () => {
    const workbook = await buildVariantMasterDataWorkbook([{
      ...banana,
      product_name: 'Cellera Hero',
      manual_sku: 'KKM-00123456789',
    }])
    const buffer = await workbook.xlsx.writeBuffer()
    const loaded = new ExcelJS.Workbook()
    await loaded.xlsx.load(buffer)
    const sheet = loaded.getWorksheet('Variant Master Data')!

    expect(sheet.columnCount).toBe(5)
    expect(sheet.getRow(1).values).toEqual([, ...VARIANT_MASTER_DATA_HEADERS])
    expect(sheet.getRow(2).values).toEqual([, 'Cellera Hero', 'Banana Milk', 'Banana Vanilla', 'BV', 'KKM-00123456789'])
    expect(sheet.getColumn(4).numFmt).toBe('@')
  })
})
