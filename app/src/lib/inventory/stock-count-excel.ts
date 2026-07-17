import type ExcelJS from 'exceljs'

export const STOCK_COUNT_EXCEL_HEADERS = [
  'Stock Configuration ID',
  'Stock SKU',
  'Variant ID',
  'Volume (ml)',
  'Packaging Version',
  'Product Group/Brand',
  'Variant Name',
  'Product Name',
  'Flavour',
  'Product Code',
  'System Quantity',
  'Physical Count',
  'Note',
] as const

const REQUIRED_IMPORT_HEADERS = [
  'Stock Configuration ID',
  'Variant ID',
  'Physical Count',
  'Note',
] as const

export interface StockCountExcelRow {
  stockConfigId: string
  stockSku: string
  variantId: string
  volumeMl: number | null
  packagingVersion: string | null
  groupName: string
  variantName: string
  productName: string
  productCode: string | null
  systemQuantity: number
  physicalCount: string
  note: string
}

export interface StockCountImportTarget {
  stockConfigId: string
  variantId: string
  stockSku: string
  physicalCount: string
  note: string
}

export interface StockCountImportResult {
  updated: number
  unchanged: number
  failed: number
  patches: Map<string, { physicalCount: string; note: string }>
  rows: Array<{
    row: number
    sku: string
    status: 'Updated' | 'Unchanged' | 'Failed'
    message: string
  }>
}

export function extractFlavour(variantName: string): string {
  const match = variantName.match(/\[([^\]]*)\]/)
  const flavour = match?.[1].trim()
  return flavour ? `[${flavour}]` : ''
}

export function formatPackagingVersion(packaging: string | null): string {
  if (packaging === 'new_box') return 'New Box'
  if (packaging === 'old_box') return 'Old Box'
  return packaging || 'Standard'
}

export function buildStockCountWorksheet(
  workbook: ExcelJS.Workbook,
  rows: StockCountExcelRow[],
): ExcelJS.Worksheet {
  const worksheet = workbook.addWorksheet('Stock Count')
  worksheet.addRow([...STOCK_COUNT_EXCEL_HEADERS])

  rows.forEach((row) => {
    worksheet.addRow([
      row.stockConfigId,
      row.stockSku,
      row.variantId,
      row.volumeMl,
      formatPackagingVersion(row.packagingVersion),
      row.groupName,
      row.variantName,
      row.productName,
      extractFlavour(row.variantName) || null,
      row.productCode || null,
      row.systemQuantity,
      row.physicalCount.trim() === '' ? null : Number(row.physicalCount),
      row.note || null,
    ])
  })

  worksheet.columns = [
    { width: 38 }, { width: 24 }, { width: 38 }, { width: 14 },
    { width: 20 }, { width: 24 }, { width: 42 }, { width: 34 },
    { width: 24 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 34 },
  ]
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = { from: 'A1', to: 'M1' }

  const header = worksheet.getRow(1)
  header.height = 24
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF97316' } }
  header.alignment = { vertical: 'middle', horizontal: 'center' }
  header.eachCell((cell) => {
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFC2410C' } } }
  })

  for (const column of [1, 2, 3, 10]) worksheet.getColumn(column).numFmt = '@'
  worksheet.getColumn(4).numFmt = '0'
  worksheet.getColumn(11).numFmt = '#,##0'
  worksheet.getColumn(12).numFmt = '#,##0'

  return worksheet
}

const normalizeHeader = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()

function resolveImportHeaders(sheet: ExcelJS.Worksheet): Map<string, number> {
  const indexes = new Map<string, number[]>()
  const headerRow = sheet.getRow(1)

  for (let column = 1; column <= sheet.columnCount; column += 1) {
    const normalized = normalizeHeader(headerRow.getCell(column).text)
    if (!normalized) continue
    indexes.set(normalized, [...(indexes.get(normalized) || []), column])
  }

  const missing = REQUIRED_IMPORT_HEADERS.filter((header) => !indexes.has(normalizeHeader(header)))
  const duplicates = REQUIRED_IMPORT_HEADERS.filter((header) => (indexes.get(normalizeHeader(header))?.length || 0) > 1)

  if (missing.includes('Stock Configuration ID')) {
    throw new Error('This Stock Count file uses an older template and cannot be imported. Export a new configuration-aware template and copy the physical counts into it.')
  }
  if (missing.length || duplicates.length) {
    const details = [
      missing.length ? `Missing required header(s): ${missing.join(', ')}.` : '',
      duplicates.length ? `Duplicate required header(s): ${duplicates.join(', ')}.` : '',
    ].filter(Boolean).join(' ')
    throw new Error(`Invalid Stock Count Excel headers. ${details}`)
  }

  return new Map(Array.from(indexes.entries()).map(([name, columns]) => [name, columns[0]]))
}

export function parseStockCountWorksheet(
  sheet: ExcelJS.Worksheet,
  targets: StockCountImportTarget[],
): StockCountImportResult {
  const headers = resolveImportHeaders(sheet)
  const column = (name: string) => headers.get(normalizeHeader(name))!
  const stockConfigIdColumn = column('Stock Configuration ID')
  const variantIdColumn = column('Variant ID')
  const physicalCountColumn = column('Physical Count')
  const noteColumn = column('Note')
  const stockSkuColumn = headers.get(normalizeHeader('Stock SKU'))
  const byConfig = new Map(targets.map((target) => [target.stockConfigId, target]))
  const seenConfigIds = new Set<string>()
  const patches = new Map<string, { physicalCount: string; note: string }>()
  const results: StockCountImportResult['rows'] = []
  let updated = 0
  let unchanged = 0

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return

    const stockConfigId = row.getCell(stockConfigIdColumn).text.trim()
    const variantId = row.getCell(variantIdColumn).text.trim()
    const sku = stockSkuColumn ? row.getCell(stockSkuColumn).text.trim() : ''
    const matched = byConfig.get(stockConfigId)

    if (!stockConfigId || !matched) {
      results.push({ row: rowNumber, sku: sku || stockConfigId || '-', status: 'Failed', message: 'Unknown or missing Stock Configuration ID.' })
      return
    }
    if (!variantId || variantId !== matched.variantId) {
      results.push({ row: rowNumber, sku: sku || matched.stockSku, status: 'Failed', message: 'Variant ID does not match the Stock Configuration ID.' })
      return
    }
    if (seenConfigIds.has(stockConfigId)) {
      results.push({ row: rowNumber, sku: sku || matched.stockSku, status: 'Failed', message: 'Duplicate Stock Configuration ID in import file.' })
      return
    }
    seenConfigIds.add(stockConfigId)

    const physicalValue = row.getCell(physicalCountColumn).value
    const physicalString = physicalValue === null || physicalValue === undefined ? '' : String(physicalValue).trim()
    const note = row.getCell(noteColumn).text.trim()

    if (physicalString !== '' && !/^\d+$/.test(physicalString)) {
      results.push({ row: rowNumber, sku: sku || matched.stockSku, status: 'Failed', message: 'Physical Count must be zero or a positive integer.' })
      return
    }

    const changed = matched.physicalCount !== physicalString || matched.note !== note
    patches.set(matched.stockConfigId, { physicalCount: physicalString, note })
    if (changed) updated += 1
    else unchanged += 1
    results.push({
      row: rowNumber,
      sku: sku || matched.stockSku,
      status: changed ? 'Updated' : 'Unchanged',
      message: physicalString === '' ? 'Blank physical count kept as not counted.' : changed ? 'Loaded into draft.' : 'No change from current draft.',
    })
  })

  return { updated, unchanged, failed: results.filter((row) => row.status === 'Failed').length, patches, rows: results }
}
