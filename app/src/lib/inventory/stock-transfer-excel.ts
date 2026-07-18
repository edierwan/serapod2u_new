import type ExcelJS from 'exceljs'
import {
  extractFlavour,
  inventoryRowKey,
  parseTransferQuantity,
  type SourceInventoryRow,
} from './stock-transfer'

export const STOCK_TRANSFER_EXCEL_HEADERS = [
  'Stock Configuration ID',
  'Stock SKU',
  'Variant ID',
  'Product Code',
  'Product Name',
  'Flavour',
  'Configuration',
  'Available',
  'Transfer Qty',
] as const

export interface StockTransferImportResult {
  updated: number
  unchanged: number
  failed: number
  quantities: Record<string, string>
  rows: Array<{
    row: number
    sku: string
    status: 'Updated' | 'Unchanged' | 'Failed'
    message: string
  }>
}

export function buildStockTransferWorksheet(
  workbook: ExcelJS.Workbook,
  rows: SourceInventoryRow[],
  quantities: Record<string, string>,
): ExcelJS.Worksheet {
  const worksheet = workbook.addWorksheet('Stock Transfer')
  worksheet.addRow([...STOCK_TRANSFER_EXCEL_HEADERS])
  rows.forEach((row) => {
    worksheet.addRow([
      row.stockConfigId,
      row.stockSku,
      row.variantId,
      row.productCode,
      row.productName,
      extractFlavour(row.variantName),
      row.configLabel,
      row.available,
      quantities[row.inventoryKey] ? Number(quantities[row.inventoryKey]) : null,
    ])
  })
  worksheet.getRow(1).font = { bold: true }
  worksheet.columns = STOCK_TRANSFER_EXCEL_HEADERS.map((header) => ({
    header,
    width: Math.max(14, header.length + 2),
  }))
  return worksheet
}

export async function parseStockTransferImport(
  workbook: ExcelJS.Workbook,
  sourceRows: SourceInventoryRow[],
): Promise<StockTransferImportResult> {
  const worksheet = workbook.worksheets[0]
  if (!worksheet) {
    return {
      updated: 0,
      unchanged: 0,
      failed: 1,
      quantities: {},
      rows: [{ row: 1, sku: '', status: 'Failed', message: 'Worksheet is empty' }],
    }
  }

  const headerRow = worksheet.getRow(1)
  const headers: string[] = []
  headerRow.eachCell((cell, col) => {
    headers[col] = String(cell.value ?? '').trim()
  })

  const required = ['Stock Configuration ID', 'Transfer Qty'] as const
  for (const name of required) {
    if (!headers.includes(name)) {
      return {
        updated: 0,
        unchanged: 0,
        failed: 1,
        quantities: {},
        rows: [{ row: 1, sku: '', status: 'Failed', message: `Missing column: ${name}` }],
      }
    }
  }

  const col = (name: string) => headers.indexOf(name)
  const byConfig = new Map(sourceRows.map((row) => [row.stockConfigId, row]))
  const quantities: Record<string, string> = {}
  const resultRows: StockTransferImportResult['rows'] = []
  let updated = 0
  let unchanged = 0
  let failed = 0

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const stockConfigId = String(row.getCell(col('Stock Configuration ID')).value ?? '').trim()
    const sku = String(row.getCell(col('Stock SKU') || -1).value ?? '').trim()
    const qtyRaw = row.getCell(col('Transfer Qty')).value
    if (!stockConfigId && (qtyRaw === null || qtyRaw === undefined || qtyRaw === '')) return

    const source = byConfig.get(stockConfigId)
    if (!source) {
      failed += 1
      resultRows.push({
        row: rowNumber,
        sku: sku || stockConfigId,
        status: 'Failed',
        message: 'Stock configuration not found in source warehouse inventory',
      })
      return
    }

    if (qtyRaw === null || qtyRaw === undefined || qtyRaw === '') {
      unchanged += 1
      resultRows.push({
        row: rowNumber,
        sku: source.stockSku,
        status: 'Unchanged',
        message: 'No transfer quantity',
      })
      return
    }

    const parsed = parseTransferQuantity(qtyRaw as string | number)
    if (!parsed.ok) {
      failed += 1
      resultRows.push({
        row: rowNumber,
        sku: source.stockSku,
        status: 'Failed',
        message: parsed.error,
      })
      return
    }
    if (parsed.value > source.available) {
      failed += 1
      resultRows.push({
        row: rowNumber,
        sku: source.stockSku,
        status: 'Failed',
        message: 'Transfer quantity cannot exceed available stock',
      })
      return
    }

    quantities[inventoryRowKey(source.variantId, source.stockConfigId)] = String(parsed.value)
    updated += 1
    resultRows.push({
      row: rowNumber,
      sku: source.stockSku,
      status: 'Updated',
      message: `Qty ${parsed.value}`,
    })
  })

  return { updated, unchanged, failed, quantities, rows: resultRows }
}
