export interface SearchableVariant {
  variant_name?: string | null
  alternative_name?: string | null
  product_code?: string | null
  barcode?: string | null
  manufacturer_sku?: string | null
}

export interface VariantMasterDataRow extends SearchableVariant {
  product_name?: string | null
  manual_sku?: string | null
}

export const VARIANT_MASTER_DATA_HEADERS = [
  'Product',
  'Flavour',
  'Alternative Name',
  'Product Code',
  'KKM Approval',
] as const

export function normalizeVariantSearch(value: string | null | undefined): string {
  return (value || '').trim().toLocaleLowerCase()
}

export function matchesVariantSearch(variant: SearchableVariant, search: string): boolean {
  const needle = normalizeVariantSearch(search)
  if (!needle) return true

  return [
    variant.variant_name,
    variant.alternative_name,
    variant.product_code,
    variant.barcode,
    variant.manufacturer_sku,
  ].some((value) => normalizeVariantSearch(value).includes(needle))
}

export function getVariantFlavour(variantName: string | null | undefined): string {
  const name = (variantName || '').trim()
  const bracketedFlavour = name.match(/\[\s*([^\]]+?)\s*\]\s*$/)
  return (bracketedFlavour?.[1] || name).trim()
}

export function toVariantMasterDataValues(row: VariantMasterDataRow): string[] {
  return [
    row.product_name || '',
    getVariantFlavour(row.variant_name),
    row.alternative_name || '',
    row.product_code || '',
    row.manual_sku || '',
  ]
}

export function buildVariantMasterDataFilename(date = new Date()): string {
  return `Product_Variant_Master_Data_${date.toISOString().slice(0, 10)}.xlsx`
}

export async function buildVariantMasterDataWorkbook(rows: VariantMasterDataRow[]) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Serapod2u'
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet('Variant Master Data')
  worksheet.columns = [
    { header: VARIANT_MASTER_DATA_HEADERS[0], key: 'product', width: 24, style: { numFmt: '@' } },
    { header: VARIANT_MASTER_DATA_HEADERS[1], key: 'flavour', width: 28, style: { numFmt: '@' } },
    { header: VARIANT_MASTER_DATA_HEADERS[2], key: 'alternativeName', width: 28, style: { numFmt: '@' } },
    { header: VARIANT_MASTER_DATA_HEADERS[3], key: 'productCode', width: 18, style: { numFmt: '@' } },
    { header: VARIANT_MASTER_DATA_HEADERS[4], key: 'kkmApproval', width: 24, style: { numFmt: '@' } },
  ]

  rows.forEach((row) => worksheet.addRow(toVariantMasterDataValues(row)))

  const header = worksheet.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
  header.alignment = { vertical: 'middle', horizontal: 'left' }
  header.height = 22
  worksheet.autoFilter = { from: 'A1', to: 'E1' }
  worksheet.views = [{ state: 'frozen', ySplit: 1 }]

  return workbook
}

export async function exportVariantMasterDataBlob(rows: VariantMasterDataRow[]): Promise<Blob> {
  const workbook = await buildVariantMasterDataWorkbook(rows)
  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
