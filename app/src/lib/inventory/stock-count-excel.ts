import type ExcelJS from 'exceljs'

export const STOCK_COUNT_EXCEL_HEADERS = [
  'Variant ID',
  'SKU',
  'Product Group/Brand',
  'Variant Name',
  'Product Name',
  'Flavour',
  'Product Code',
  'System Quantity',
  'Physical Count',
  'Note',
] as const

const REQUIRED_IMPORT_HEADERS = ['Variant ID', 'Physical Count', 'Note'] as const

export interface StockCountExcelRow {
  variantId: string
  sku: string
  groupName: string
  variantName: string
  productName: string
  productCode: string | null
  systemQuantity: number
  physicalCount: string
  note: string
}

export interface StockCountImportTarget {
  variantId: string
  sku: string
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

export function buildStockCountWorksheet(
  workbook: ExcelJS.Workbook,
  rows: StockCountExcelRow[],
): ExcelJS.Worksheet {
  const worksheet = workbook.addWorksheet('Stock Count')
  worksheet.addRow([...STOCK_COUNT_EXCEL_HEADERS])

  rows.forEach((row) => {
    worksheet.addRow([
      row.variantId,
      row.sku,
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
    { width: 38 },
    { width: 22 },
    { width: 24 },
    { width: 42 },
    { width: 34 },
    { width: 24 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 34 },
  ]
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = { from: 'A1', to: 'J1' }

  const header = worksheet.getRow(1)
  header.height = 24
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF97316' } }
  header.alignment = { vertical: 'middle', horizontal: 'center' }
  header.eachCell((cell) => {
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFC2410C' } } }
  })

  worksheet.getColumn(1).numFmt = '@'
  worksheet.getColumn(2).numFmt = '@'
  worksheet.getColumn(7).numFmt = '@'
  worksheet.getColumn(8).numFmt = '#,##0'
  worksheet.getColumn(9).numFmt = '#,##0'

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

  const missing = REQUIRED_IMPORT_HEADERS.filter(
    (header) => !indexes.has(normalizeHeader(header)),
  )
  const duplicates = REQUIRED_IMPORT_HEADERS.filter(
    (header) => (indexes.get(normalizeHeader(header))?.length || 0) > 1,
  )

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
  const variantIdColumn = column('Variant ID')
  const physicalCountColumn = column('Physical Count')
  const noteColumn = column('Note')
  const skuColumn = headers.get(normalizeHeader('SKU'))
  const byVariant = new Map(targets.map((row) => [row.variantId, row]))
  const seenVariantIds = new Set<string>()
  const patches = new Map<string, { physicalCount: string; note: string }>()
  const results: StockCountImportResult['rows'] = []
  let updated = 0
  let unchanged = 0

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return

    const variantId = row.getCell(variantIdColumn).text.trim()
    const sku = skuColumn ? row.getCell(skuColumn).text.trim() : ''
    const matched = byVariant.get(variantId)

    if (!variantId || !matched) {
      results.push({
        row: rowNumber,
        sku: sku || variantId || '-',
        status: 'Failed',
        message: 'Unknown or missing Variant ID.',
      })
      return
    }
    if (seenVariantIds.has(variantId)) {
      results.push({
        row: rowNumber,
        sku: sku || variantId,
        status: 'Failed',
        message: 'Duplicate Variant ID in import file.',
      })
      return
    }
    seenVariantIds.add(variantId)

    const physicalValue = row.getCell(physicalCountColumn).value
    const physicalString = physicalValue === null || physicalValue === undefined
      ? ''
      : String(physicalValue).trim()
    const note = row.getCell(noteColumn).text.trim()

    if (physicalString !== '' && !/^\d+$/.test(physicalString)) {
      results.push({
        row: rowNumber,
        sku: sku || variantId,
        status: 'Failed',
        message: 'Physical Count must be zero or a positive integer.',
      })
      return
    }

    const changed = matched.physicalCount !== physicalString || matched.note !== note
    patches.set(matched.variantId, { physicalCount: physicalString, note })
    if (changed) updated += 1
    else unchanged += 1
    results.push({
      row: rowNumber,
      sku: sku || variantId,
      status: changed ? 'Updated' : 'Unchanged',
      message: physicalString === ''
        ? 'Blank physical count kept as not counted.'
        : changed
          ? 'Loaded into draft.'
          : 'No change from current draft.',
    })
  })

  return {
    updated,
    unchanged,
    failed: results.filter((row) => row.status === 'Failed').length,
    patches,
    rows: results,
  }
}
