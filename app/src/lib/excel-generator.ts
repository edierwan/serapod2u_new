/**
 * Excel Generator Utility
 * Generates MULTIPLE Excel files for QR code batches (split into 10K per file)
 * Then creates a ZIP archive of all files
 * Optimized for 200K+ codes with streaming ExcelJS writer
 */

import ExcelJS from 'exceljs'
import { createWriteStream, createReadStream } from 'fs'
import { unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { finished } from 'stream/promises'
import archiver, { type Archiver } from 'archiver'
import { GeneratedMasterCode, GeneratedQRCode } from './qr-generator'
import type { NextResponse } from 'next/server'

/**
 * Get the base URL for QR code tracking
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

/**
 * Extract only the flavor/variant name from brackets
 * Example: "Cellera Hero - Deluxe Cellera Cartridge [ Keladi Cheese ]" → "[ Keladi Cheese ]"
 * Example: "Product - Variant [ Flavor ]" → "[ Flavor ]"
 */
function extractFlavorOnly(variantName: string): string {
  const match = variantName.match(/\[([^\]]+)\]/)
  if (match) {
    return `[ ${match[1].trim()} ]`
  }
  // If no brackets found, return the original variant name
  return variantName
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
  extraQrMaster: number
}

const URL_THRESHOLD = 10_000
const CODES_PER_FILE = 1_000_000 // Keep all codes in single file (changed from 10K to 1M)

type ProductGroupAggregate = {
  firstCode: GeneratedQRCode
  lastCode: GeneratedQRCode
  count: number
}

type CaseProductAggregates = Map<string, Map<string, number>>

/**
 * Generate single Excel file for QR batch with all codes
 * Returns path to the Excel file (no ZIP needed for single file)
 * Optimized for large batches using streaming ExcelJS writer
 */
export async function generateQRExcel(data: QRExcelData): Promise<string> {
  console.log(`📊 Starting Excel generation: ${data.totalUniqueCodes} codes`)
  const startTime = Date.now()

  const excelFilePath = join(tmpdir(), `qr-batch-${randomUUID()}.xlsx`)

  try {
    console.log('  ⏳ Step 1: Calculating aggregates...')
    const { productGroups, caseProductCounts } = calculateAggregates(data)
    console.log(`  ✅ Aggregates calculated: ${productGroups.size} product groups, ${caseProductCounts.size} cases`)

    console.log(`📄 Generating single Excel file with ${data.individualCodes.length} codes`)

    const writeStream = createWriteStream(excelFilePath)
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: writeStream,
      useStyles: false,
      useSharedStrings: false
    })

    // Build all sheets in order
    await buildSummarySheet(workbook, data)
    await buildMasterSheet(workbook, data)
    await buildIndividualSheet(workbook, data, data.individualCodes)
    await buildProductBreakdownSheet(workbook, data, productGroups)
    // Packing List sheet removed - not needed
    // await buildPackingSheet(workbook, data, caseProductCounts)

    await workbook.commit()
    await finished(writeStream)

    const stats = await import('fs/promises').then(fs => fs.stat(excelFilePath))
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2)
    console.log(`✅ Excel generation complete in ${elapsedTime}s (File: ${(stats.size / 1024 / 1024).toFixed(2)} MB)`)

    return excelFilePath
  } catch (error) {
    console.error('❌ Excel generation failed:', error)
    console.error('Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    // Cleanup on error
    await unlink(excelFilePath).catch(() => {})
    throw error
  }
}



/**
 * Calculate aggregates once (used by all Excel files)
 */
function calculateAggregates(data: QRExcelData): {
  productGroups: Map<string, ProductGroupAggregate>
  caseProductCounts: CaseProductAggregates
} {
  const productGroups = new Map<string, ProductGroupAggregate>()
  const caseProductCounts: CaseProductAggregates = new Map()

  data.individualCodes.forEach((code) => {
    const key = `${code.product_code}-${code.variant_code || 'default'}`
    
    if (!productGroups.has(key)) {
      productGroups.set(key, {
        firstCode: code,
        lastCode: code,
        count: 1
      })
    } else {
      const group = productGroups.get(key)!
      group.lastCode = code
      group.count++
    }

    if (code.case_number) {
      const caseKey = String(code.case_number)
      if (!caseProductCounts.has(caseKey)) {
        caseProductCounts.set(caseKey, new Map())
      }
      const caseMap = caseProductCounts.get(caseKey)!
      caseMap.set(key, (caseMap.get(key) || 0) + 1)
    }
  })

  return { productGroups, caseProductCounts }
}



/**
 * Stream file as HTTP response and cleanup after
 */
export async function streamFileAsResponse(
  filePath: string,
  filename: string
): Promise<Response> {
  const stats = await import('fs/promises').then(fs => fs.stat(filePath))
  const stream = createReadStream(filePath)

  // Create a Response with the stream
  const response = new Response(stream as any, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': stats.size.toString(),
      'Cache-Control': 'no-cache'
    }
  })

  // Cleanup file after stream finishes
  stream.on('end', () => {
    unlink(filePath).catch(err => console.error('Failed to cleanup temp file:', err))
  })

  stream.on('error', () => {
    unlink(filePath).catch(() => {})
  })

  return response
}

async function buildSummarySheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  data: QRExcelData
): Promise<void> {
  const sheet = workbook.addWorksheet('Summary')
  sheet.columns = [
    { header: '', key: 'col1', width: 35 },
    { header: '', key: 'col2', width: 45 }
  ]

  const rows: Array<[string, string]> = [
    ['QR Code Batch Report', ''],
    ['Generated:', new Date().toLocaleString()],
    ['', ''],
    ['Order Information', ''],
    ['Order Number:', data.orderNo],
    ['Order Date:', data.orderDate],
    ['Company:', data.companyName],
    ['Manufacturer:', data.manufacturerName],
    ['', ''],
    ['QR Code Statistics', ''],
    ['Total Cases:', data.totalMasterCodes.toString()],
    ['Total Master Codes (Cases):', data.totalMasterCodes.toString()],
    ['Total Individual Codes:', data.totalUniqueCodes.toString()],
    ['Buffer Percentage:', `${data.bufferPercent}%`],
    ['', ''],
    ['Tracking System', ''],
    ['Base URL:', getBaseURL()],
    ['Product Tracking:', `${getBaseURL()}/track/product/[CODE]`],
    ['Master Tracking:', `${getBaseURL()}/track/master/[CODE]`],
    ['', ''],
    ['Instructions', ''],
    ['1. Print Master QR codes and attach to cases/boxes', ''],
    ['2. Print Individual QR codes and attach to each product unit', ''],
    ['3. Scan Master QR when packing products into cases', ''],
    ['4. Scan Individual QR codes during manufacturing process', ''],
    ['5. Each QR code contains a tracking URL that can be scanned', '']
  ]

  for (const [col1, col2] of rows) {
    const row = sheet.addRow([col1 ?? '', col2 ?? ''])
    row.commit()
  }

  await sheet.commit()
  console.log('✅ Summary sheet created')
}

async function buildMasterSheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  data: QRExcelData
): Promise<void> {
  const sheet = workbook.addWorksheet('Master QR Codes')
  sheet.columns = [
    { header: '#', key: 'index', width: 6 },
    { header: 'Tracking URL', key: 'trackingUrl', width: 60 },
    { header: 'Case Number', key: 'caseNumber', width: 14 },
    { header: 'Expected Units', key: 'expectedUnits', width: 16 },
    { header: 'Variant', key: 'variantLabel', width: 50 }  // NEW: Show which variant(s) in this case
  ]

  // Build helper maps to determine which variants are in each case
  // caseNumber -> Set<variantKey>
  // variantKey -> "Product Name - Variant Name"
  const caseVariants = new Map<number, Set<string>>()
  const variantNames = new Map<string, string>()

  // Analyze individual codes (excluding buffer codes) to map case → variants
  for (const code of data.individualCodes) {
    if (code.is_buffer) continue // Ignore buffer codes - they're not packed in cases

    const caseNo = code.case_number
    const variantKey = `${code.product_code}-${code.variant_code}`

    // Store the friendly name for this variant (flavor only)
    if (!variantNames.has(variantKey)) {
      variantNames.set(
        variantKey,
        extractFlavorOnly(code.variant_name)
      )
    }

    // Track which variants appear in this case
    if (!caseVariants.has(caseNo)) {
      caseVariants.set(caseNo, new Set())
    }
    caseVariants.get(caseNo)!.add(variantKey)
  }

  let rowIndex = 1
  // Repeat each master code N times for redundancy (backup copies)
  // extraQrMaster is the number of ADDITIONAL duplicates (0-10)
  // So total copies = 1 (original) + duplicates
  const duplicateCount = data.extraQrMaster ?? 0  // Default to 0 duplicates
  const copiesPerMaster = 1 + duplicateCount        // Always print at least 1, plus duplicates
  
  data.masterCodes.forEach((master) => {
    // Determine variant label for this case
    const variantsSet = caseVariants.get(master.case_number)
    let variantLabel = ''

    if (variantsSet && variantsSet.size > 0) {
      const keys = Array.from(variantsSet)
      if (keys.length === 1) {
        // Single variant case
        const key = keys[0]
        variantLabel = variantNames.get(key) ?? key
      } else {
        // Mixed variant case
        const names = keys.map(k => variantNames.get(k) ?? k)
        variantLabel = `MIXED: ${names.join(' + ')}`
      }
    }

    // Repeat master code for redundancy with variant info
    for (let i = 0; i < copiesPerMaster; i++) {
      const row = sheet.addRow({
        index: rowIndex++,
        trackingUrl: generateTrackingURL(master.code, 'master'),
        caseNumber: master.case_number,
        expectedUnits: master.expected_unit_count,
        variantLabel  // Show which variant(s) are in this case
      })
      row.commit()
    }
  })

  await sheet.commit()
  const totalRows = data.masterCodes.length * copiesPerMaster
  console.log(`✅ Master QR Codes sheet created (${data.masterCodes.length} unique codes × ${copiesPerMaster} copies (1 + ${duplicateCount} duplicates) = ${totalRows} rows)`)
}

/**
 * Build Individual QR Codes sheet for a single Excel file
 * Streams row-by-row with immediate commit for memory efficiency
 * 
 * Case Number Logic:
 * - Production codes: Use per-variant local sequence to calculate case number
 * - Buffer codes: Show BUFFER-N and Buffer Group for identification
 */
async function buildIndividualSheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  data: QRExcelData,
  codesSlice: GeneratedQRCode[]
): Promise<void> {
  const sheetName = 'Individual QR Codes'

  const sheet = workbook.addWorksheet(sheetName)
  
  // Column order:
  // 1. # (A)
  // 2. Product Name (B)
  // 3. Variant (C)
  // 4. Individual Tracking URL (D)
  // 5. Sequence (E)
  // 6. Product Code (F)
  // 7. Variant Code (G)
  // 8. Case Number (H)
  // 9. Is Buffer (I)
  // 10. Buffer Group (J) - NEW: Identifies which variant each buffer belongs to
  sheet.columns = [
    { header: '#', key: 'index', width: 6 },
    { header: 'Product Name', key: 'productName', width: 32 },
    { header: 'Variant', key: 'variantName', width: 24 },
    { header: 'Individual Tracking URL', key: 'trackingUrl', width: 65 },
    { header: 'Sequence', key: 'sequence', width: 12 },
    { header: 'Product Code', key: 'productCode', width: 18 },
    { header: 'Variant Code', key: 'variantCode', width: 18 },
    { header: 'Case Number', key: 'caseNumber', width: 14 },
    { header: 'Is Buffer', key: 'isBuffer', width: 12 },
    { header: 'Buffer Group', key: 'bufferGroup', width: 22 }
  ]

  // Track buffer sequence per variant (for buffer codes only)
  const variantBufferSeq = new Map<string, number>()
  
  for (let i = 0; i < codesSlice.length; i++) {
    const code = codesSlice[i]
    
    // Use global case number from QR generator
    // - Production codes: Use code.case_number (already calculated globally during generation)
    // - Buffer codes: Show BUFFER-N and generate Buffer Group ID
    let caseNumber: number | string | null = null
    let bufferGroup = ''
    
    if (!code.is_buffer) {
      // Production code - use the global case number assigned during QR generation
      caseNumber = code.case_number
    } else {
      // Buffer code - use fixed BUFFER-1 label and generate unique Buffer Group
      const variantKey = `${code.product_code}-${code.variant_code}`
      const currentBufferSeq = (variantBufferSeq.get(variantKey) || 0) + 1
      variantBufferSeq.set(variantKey, currentBufferSeq)
      
      // Case Number shows fixed BUFFER-1 for all buffer codes
      // This allows filtering all buffer codes at once per variant
      caseNumber = 'BUFFER-1'
      
      // Buffer Group: B{variant_code}-{0001 format} - remains unique per buffer QR
      // Example: BCHI-449021-0012
      bufferGroup = `B${code.variant_code}-${String(currentBufferSeq).padStart(4, '0')}`
    }

    // Build row data with new Buffer Group column
    const rowData: any = {
      index: i + 1,
      trackingUrl: generateTrackingURL(code.code, 'product'),
      sequence: code.sequence_number,
      productCode: code.product_code,
      variantCode: code.variant_code,
      productName: code.product_name,
      variantName: extractFlavorOnly(code.variant_name),  // Show only flavor in brackets
      caseNumber: caseNumber, // Number for production, BUFFER-N for buffer codes
      isBuffer: code.is_buffer ? 'TRUE' : 'FALSE',
      bufferGroup: bufferGroup // Empty for production, B{variant}-{seq} for buffer
    }

    const row = sheet.addRow(rowData)
    row.commit()

    if ((i + 1) % 5_000 === 0) {
      console.log(`  ⏳ Processed ${i + 1}/${codesSlice.length} codes in this file...`)
    }
  }

  await sheet.commit()
  console.log(`✅ ${sheetName} created (${codesSlice.length} codes)`)
}

async function buildProductBreakdownSheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  data: QRExcelData,
  productGroups: Map<string, ProductGroupAggregate>
): Promise<void> {
  const sheet = workbook.addWorksheet('Product Breakdown')
  sheet.columns = [
    { header: 'Product Code', key: 'productCode', width: 18 },
    { header: 'Variant Code', key: 'variantCode', width: 18 },
    { header: 'Product Name', key: 'productName', width: 32 },
    { header: 'Variant', key: 'variantName', width: 24 },
    { header: 'Total QR Codes', key: 'totalQrCodes', width: 18 },
    { header: 'First Code', key: 'firstCode', width: 48 },
    { header: 'Last Code', key: 'lastCode', width: 48 },
    { header: 'Case Range', key: 'caseRange', width: 20 },
    { header: 'Cases Box', key: 'casesBox', width: 14 }
  ]

  productGroups.forEach(group => {
    // Filter production codes only (exclude buffer codes) for this variant
    const allCodesForGroup = data.individualCodes.filter(
      c => c.product_code === group.firstCode.product_code &&
           c.variant_code === group.firstCode.variant_code &&
           !c.is_buffer    // production only - exclude buffer codes
    )

    // Sort by case_number (numeric) to get first and last production cases
    allCodesForGroup.sort((a, b) => Number(a.case_number) - Number(b.case_number))

    // Get first and last production case numbers
    const firstCase = allCodesForGroup[0]?.case_number || ''
    const lastCase = allCodesForGroup[allCodesForGroup.length - 1]?.case_number || ''

    const row = sheet.addRow({
      productCode: group.firstCode.product_code,
      variantCode: group.firstCode.variant_code,
      productName: group.firstCode.product_name,
      variantName: group.firstCode.variant_name,
      totalQrCodes: group.count,
      firstCode: group.firstCode.code,
      lastCode: group.lastCode.code,
      caseRange: `${firstCase} - ${lastCase}`,  // Now shows production cases only
      casesBox: group.firstCode.units_per_case || 100
    })
    row.commit()
  })

  await sheet.commit()
  console.log('✅ Product Breakdown sheet created')
}

async function buildPackingSheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  data: QRExcelData,
  caseProductCounts: CaseProductAggregates
): Promise<void> {
  const sheet = workbook.addWorksheet('Packing List')
  sheet.columns = [
    { header: 'Case Number', key: 'caseNumber', width: 14 },
    { header: 'Master QR Code', key: 'masterCode', width: 45 },
    { header: 'Expected Units', key: 'expectedUnits', width: 16 },
    { header: 'Products in Case', key: 'productsInCase', width: 60 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Packed By', key: 'packedBy', width: 20 },
    { header: 'Packed Date', key: 'packedDate', width: 18 }
  ]

  data.masterCodes.forEach(master => {
    const productCounts = caseProductCounts.get(String(master.case_number))
    const productList = productCounts
      ? Array.from(productCounts.entries())
          .map(([name, count]) => `${name} (${count})`)
          .join('; ')
      : ''

    const row = sheet.addRow({
      caseNumber: master.case_number,
      masterCode: master.code,
      expectedUnits: master.expected_unit_count,
      productsInCase: productList,
      status: '☐ Packed',
      packedBy: '',
      packedDate: ''
    })
    row.commit()
  })

  await sheet.commit()
  console.log('✅ Packing List sheet created')
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
