import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  STOCK_COUNT_EXCEL_HEADERS,
  buildStockCountWorksheet,
  extractFlavour,
  parseStockCountWorksheet,
  type StockCountExcelRow,
} from './stock-count-excel'

const sourceRows: StockCountExcelRow[] = [
  {
    stockConfigId: 'config-20nb', stockSku: 'SKU-001-20NB', variantId: 'variant-1',
    volumeMl: 20, packagingVersion: 'new_box', groupName: 'Cartridge',
    variantName: 'Deluxe Cellera Cartridge [ Banana Milk ]', productName: 'Cellera Hero',
    productCode: '00123', systemQuantity: 3997, physicalCount: '', note: '',
  },
  {
    stockConfigId: 'config-50nb', stockSku: 'SKU-001-50NB', variantId: 'variant-1',
    volumeMl: 50, packagingVersion: 'new_box', groupName: 'Cartridge',
    variantName: 'Deluxe Cellera Cartridge [ Banana Milk ]', productName: 'Cellera Hero',
    productCode: '00123', systemQuantity: 12, physicalCount: '', note: '',
  },
]

const targets = () => sourceRows.map((row) => ({
  stockConfigId: row.stockConfigId,
  variantId: row.variantId,
  stockSku: row.stockSku,
  physicalCount: row.physicalCount,
  note: row.note,
}))

describe('Stock Count Excel', () => {
  it('extracts and trims bracketed Flavour without changing the Variant Name', () => {
    const variantName = 'Deluxe Cellera Cartridge [ Banana Milk ]'
    expect(extractFlavour(variantName)).toBe('[Banana Milk]')
    expect(variantName).toBe('Deluxe Cellera Cartridge [ Banana Milk ]')
    expect(extractFlavour('Variant without square brackets')).toBe('')
  })

  it('exports configuration identity and dimensions in the exact A-M order', () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = buildStockCountWorksheet(workbook, sourceRows)

    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual([...STOCK_COUNT_EXCEL_HEADERS])
    expect(sheet.getCell('A2').value).toBe('config-20nb')
    expect(sheet.getCell('B2').value).toBe('SKU-001-20NB')
    expect(sheet.getCell('C2').value).toBe('variant-1')
    expect(sheet.getCell('D2').value).toBe(20)
    expect(sheet.getCell('E2').value).toBe('New Box')
    expect(sheet.getCell('J2').value).toBe('00123')
    expect(sheet.getColumn(10).numFmt).toBe('@')
    expect(sheet.autoFilter).toEqual({ from: 'A1', to: 'M1' })
  })

  it('matches two rows for one flavour independently by Stock Configuration ID', () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = buildStockCountWorksheet(workbook, sourceRows)
    sheet.getCell('L2').value = 25
    sheet.getCell('M2').value = '20ml shelf'
    sheet.getCell('L3').value = 8
    sheet.getCell('M3').value = '50ml shelf'

    const result = parseStockCountWorksheet(sheet, targets())
    expect(result.patches.get('config-20nb')).toEqual({ physicalCount: '25', note: '20ml shelf' })
    expect(result.patches.get('config-50nb')).toEqual({ physicalCount: '8', note: '50ml shelf' })
    expect(result.updated).toBe(2)
  })

  it('rejects old variant-only templates with a clear compatibility message', () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Old Stock Count')
    sheet.addRow(['Variant ID', 'SKU', 'System Quantity', 'Physical Count', 'Note'])
    sheet.addRow(['variant-1', 'SKU-001', 10, 9, 'Legacy'])

    expect(() => parseStockCountWorksheet(sheet, targets())).toThrow(
      'This Stock Count file uses an older template and cannot be imported. Export a new configuration-aware template and copy the physical counts into it.',
    )
  })

  it('does not silently accept a mismatched Variant ID', () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = buildStockCountWorksheet(workbook, sourceRows)
    sheet.getCell('C2').value = 'different-variant'

    const result = parseStockCountWorksheet(sheet, targets())
    expect(result.rows[0]).toMatchObject({ status: 'Failed', message: 'Variant ID does not match the Stock Configuration ID.' })
    expect(result.patches.has('config-20nb')).toBe(false)
  })

  it('rejects duplicate configuration IDs even when Variant IDs are identical', () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = buildStockCountWorksheet(workbook, sourceRows)
    sheet.getCell('A3').value = 'config-20nb'

    const result = parseStockCountWorksheet(sheet, targets())
    expect(result.rows[1]).toMatchObject({ status: 'Failed', message: 'Duplicate Stock Configuration ID in import file.' })
  })

  it('round trips configuration IDs, leading-zero product codes, and count fields', async () => {
    const exported = new ExcelJS.Workbook()
    buildStockCountWorksheet(exported, sourceRows)
    const buffer = await exported.xlsx.writeBuffer()
    const imported = new ExcelJS.Workbook()
    await imported.xlsx.load(buffer)
    const sheet = imported.worksheets[0]

    expect(sheet.getCell('A2').text).toBe('config-20nb')
    expect(sheet.getCell('J2').text).toBe('00123')
    sheet.getCell('L2').value = 3998
    sheet.getCell('M2').value = 'Round trip'

    const result = parseStockCountWorksheet(sheet, targets())
    expect(result.patches.get('config-20nb')).toEqual({ physicalCount: '3998', note: 'Round trip' })
  })
})
