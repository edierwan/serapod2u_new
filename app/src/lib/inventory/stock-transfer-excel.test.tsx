import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import {
  buildStockTransferWorksheet,
  parseStockTransferImport,
} from './stock-transfer-excel'
import { inventoryRowKey, type SourceInventoryRow } from './stock-transfer'

const source: SourceInventoryRow[] = [
  {
    inventoryKey: inventoryRowKey('var-1', 'cfg-20nb'),
    variantId: 'var-1',
    stockConfigId: 'cfg-20nb',
    productId: 'prod-1',
    productCode: 'CEL-001',
    productName: 'Cellera',
    variantName: 'Cellera [Mango]',
    flavour: 'Cellera [Mango]',
    productLine: 'Cellera',
    configLabel: '20ml New Box',
    stockSku: 'CEL-MANGO-20NB',
    volumeMl: 20,
    packaging: 'new_box',
    configCode: '20NB',
    available: 50,
    unitCost: 10,
  },
]

describe('stock transfer excel', () => {
  it('exports and imports quantities matched by stock_config_id', async () => {
    const workbook = new ExcelJS.Workbook()
    buildStockTransferWorksheet(workbook, source, {
      [inventoryRowKey('var-1', 'cfg-20nb')]: '20',
    })

    const parsed = await parseStockTransferImport(workbook, source)
    expect(parsed.updated).toBe(1)
    expect(parsed.failed).toBe(0)
    expect(parsed.quantities[inventoryRowKey('var-1', 'cfg-20nb')]).toBe('20')
  })

  it('rejects over-available import quantities and unknown configurations', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Stock Transfer')
    sheet.addRow([
      'Stock Configuration ID',
      'Stock SKU',
      'Variant ID',
      'Product Code',
      'Product Name',
      'Flavour',
      'Configuration',
      'Available',
      'Transfer Qty',
    ])
    sheet.addRow(['cfg-20nb', 'CEL-MANGO-20NB', 'var-1', 'CEL-001', 'Cellera', '[Mango]', '20ml New Box', 50, 99])
    sheet.addRow(['missing', 'X', 'var-x', 'X', 'X', 'X', 'X', 0, 1])

    const parsed = await parseStockTransferImport(workbook, source)
    expect(parsed.failed).toBe(2)
    expect(parsed.updated).toBe(0)
  })
})
