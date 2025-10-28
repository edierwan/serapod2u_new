/**
 * Excel Generator Utility
 * Generates Excel files for QR code batches
 */

import * as XLSX from 'xlsx'
import { GeneratedMasterCode, GeneratedQRCode } from './qr-generator'

/**
 * Get the base URL for QR code tracking
 * Uses environment variable or falls back to production URL
 */
function getBaseURL(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://www.serapod2u.com'
}

/**
 * Generate tracking URL for a QR code
 */
function generateTrackingURL(code: string, type: 'product' | 'master'): string {
  const baseUrl = getBaseURL()
  return `${baseUrl}/track/${type}/${code}`
}

export interface QRExcelData {
  orderNo: string
  orderDate: string
  companyName: string
  manufacturerName: string
  masterCodes: GeneratedMasterCode[]
  individualCodes: GeneratedQRCode[]
  totalMasterCodes: number
  totalUniqueCodes: number
  bufferPercent: number
}

/**
 * Generate Excel file for QR batch
 * Returns Buffer that can be uploaded to storage or downloaded
 */
export function generateQRExcel(data: QRExcelData): Buffer {
  const workbook = XLSX.utils.book_new()

  // ===== SHEET 1: Summary =====
  const summaryData = [
    ['QR Code Batch Report'],
    ['Generated:', new Date().toLocaleString()],
    [],
    ['Order Information'],
    ['Order Number:', data.orderNo],
    ['Order Date:', data.orderDate],
    ['Company:', data.companyName],
    ['Manufacturer:', data.manufacturerName],
    [],
    ['QR Code Statistics'],
    ['Total Master Codes (Cases):', data.totalMasterCodes],
    ['Total Individual Codes:', data.totalUniqueCodes],
    ['Buffer Percentage:', `${data.bufferPercent}%`],
    [],
    ['Tracking System'],
    ['Base URL:', getBaseURL()],
    ['Product Tracking:', `${getBaseURL()}/track/product/[CODE]`],
    ['Master Tracking:', `${getBaseURL()}/track/master/[CODE]`],
    [],
    ['Instructions'],
    ['1. Print Master QR codes and attach to cases/boxes'],
    ['2. Print Individual QR codes and attach to each product unit'],
    ['3. Scan Master QR when packing products into cases'],
    ['4. Scan Individual QR codes during manufacturing process'],
    ['5. Each QR code contains a tracking URL that can be scanned']
  ]

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
  
  // Set column widths
  summarySheet['!cols'] = [
    { wch: 30 },
    { wch: 40 }
  ]

  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

  // ===== SHEET 2: Master QR Codes =====
  const masterSheetData = data.masterCodes.map((master, index) => ({
    '#': index + 1,
    'Master QR Code': master.code,
    'Tracking URL': generateTrackingURL(master.code, 'master'),
    'Case Number': master.case_number,
    'Expected Units': master.expected_unit_count,
    'Order No': data.orderNo,
    'Print Instructions': 'Print at 5cm x 5cm minimum size'
  }))

  const masterSheet = XLSX.utils.json_to_sheet(masterSheetData)
  
  // Set column widths
  masterSheet['!cols'] = [
    { wch: 5 },   // #
    { wch: 45 },  // Master QR Code
    { wch: 60 },  // Tracking URL
    { wch: 12 },  // Case Number
    { wch: 14 },  // Expected Units
    { wch: 20 },  // Order No
    { wch: 35 }   // Print Instructions
  ]

  XLSX.utils.book_append_sheet(workbook, masterSheet, 'Master QR Codes')

  // ===== SHEET 3: Individual QR Codes =====
  const individualSheetData = data.individualCodes.map((code, index) => ({
    '#': index + 1,
    'Individual QR Code': code.code,
    'Tracking URL': generateTrackingURL(code.code, 'product'),
    'Sequence': code.sequence_number,
    'Product Code': code.product_code,
    'Variant Code': code.variant_code,
    'Product Name': code.product_name,
    'Variant': code.variant_name,
    'Case Number': code.case_number,
    'Order No': data.orderNo,
    'Print Instructions': 'Print at 2cm x 2cm minimum size'
  }))

  const individualSheet = XLSX.utils.json_to_sheet(individualSheetData)
  
  // Set column widths
  individualSheet['!cols'] = [
    { wch: 5 },   // #
    { wch: 50 },  // Individual QR Code
    { wch: 60 },  // Tracking URL
    { wch: 10 },  // Sequence
    { wch: 15 },  // Product Code
    { wch: 15 },  // Variant Code
    { wch: 30 },  // Product Name
    { wch: 20 },  // Variant
    { wch: 12 },  // Case Number
    { wch: 20 },  // Order No
    { wch: 35 }   // Print Instructions
  ]

  XLSX.utils.book_append_sheet(workbook, individualSheet, 'Individual QR Codes')

  // ===== SHEET 4: By Product Breakdown =====
  // Group codes by product
  const productGroups = new Map<string, GeneratedQRCode[]>()
  
  for (const code of data.individualCodes) {
    const key = `${code.product_code}-${code.variant_code}`
    if (!productGroups.has(key)) {
      productGroups.set(key, [])
    }
    productGroups.get(key)!.push(code)
  }

  const productBreakdownData: any[] = []
  
  // Convert Map to Array for iteration
  Array.from(productGroups.entries()).forEach(([key, codes]) => {
    const firstCode = codes[0]
    productBreakdownData.push({
      'Product Code': firstCode.product_code,
      'Variant Code': firstCode.variant_code,
      'Product Name': firstCode.product_name,
      'Variant': firstCode.variant_name,
      'Total QR Codes': codes.length,
      'First Code': codes[0].code,
      'Last Code': codes[codes.length - 1].code,
      'Case Range': `${codes[0].case_number} - ${codes[codes.length - 1].case_number}`
    })
  })

  const productBreakdownSheet = XLSX.utils.json_to_sheet(productBreakdownData)
  
  // Set column widths
  productBreakdownSheet['!cols'] = [
    { wch: 15 },  // Product Code
    { wch: 15 },  // Variant Code
    { wch: 30 },  // Product Name
    { wch: 20 },  // Variant
    { wch: 15 },  // Total QR Codes
    { wch: 50 },  // First Code
    { wch: 50 },  // Last Code
    { wch: 15 }   // Case Range
  ]

  XLSX.utils.book_append_sheet(workbook, productBreakdownSheet, 'Product Breakdown')

  // ===== SHEET 5: Packing List =====
  const packingListData = data.masterCodes.map(master => {
    // Get codes for this case
    const codesInCase = data.individualCodes.filter(c => c.case_number === master.case_number)
    
    // Group by product
    const productCounts = new Map<string, { name: string, count: number }>()
    for (const code of codesInCase) {
      const key = `${code.product_name} - ${code.variant_name}`
      if (!productCounts.has(key)) {
        productCounts.set(key, { name: key, count: 0 })
      }
      productCounts.get(key)!.count++
    }

    const productList = Array.from(productCounts.values())
      .map(p => `${p.name} (${p.count})`)
      .join('; ')

    return {
      'Case Number': master.case_number,
      'Master QR Code': master.code,
      'Expected Units': master.expected_unit_count,
      'Products in Case': productList,
      'Status': '☐ Packed',
      'Packed By': '',
      'Packed Date': ''
    }
  })

  const packingSheet = XLSX.utils.json_to_sheet(packingListData)
  
  // Set column widths
  packingSheet['!cols'] = [
    { wch: 12 },  // Case Number
    { wch: 45 },  // Master QR Code
    { wch: 14 },  // Expected Units
    { wch: 60 },  // Products in Case
    { wch: 10 },  // Status
    { wch: 20 },  // Packed By
    { wch: 15 }   // Packed Date
  ]

  XLSX.utils.book_append_sheet(workbook, packingSheet, 'Packing List')

  // Generate buffer
  const buffer = XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
    compression: true
  })

  return Buffer.from(buffer)
}

/**
 * Generate filename for QR batch Excel
 */
export function generateQRExcelFilename(orderNo: string): string {
  return `QR_Batch_${orderNo}.xlsx`
}

/**
 * Generate simple CSV for quick scanning (alternative to Excel)
 */
export function generateQRCSV(codes: GeneratedQRCode[]): string {
  const headers = ['QR Code', 'Sequence', 'Product', 'Variant', 'Case']
  const rows = codes.map(code => [
    code.code,
    code.sequence_number,
    code.product_name,
    code.variant_name,
    code.case_number
  ])

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n')

  return csv
}
