/**
 * QR Code Generator Utility
 * Generates unique QR code strings for products and master cases
 */

/**
 * Generate unique QR code string for individual products
 * Format: PROD-{product_code}-{variant_code}-{order_no}-{sequence}
 * Example: PROD-VAPE001-MINT-ORD-HM-1025-11-00001
 */
export function generateProductQRCode(
  productCode: string,
  variantCode: string,
  orderNo: string,
  sequence: number
): string {
  const paddedSequence = String(sequence).padStart(5, '0')
  return `PROD-${productCode}-${variantCode}-${orderNo}-${paddedSequence}`
}

/**
 * Generate unique Master QR code string for cases/boxes
 * Format: MASTER-{order_no}-CASE-{case_number}
 * Example: MASTER-ORD-HM-1025-11-CASE-001
 */
export function generateMasterQRCode(
  orderNo: string,
  caseNumber: number
): string {
  const paddedCaseNumber = String(caseNumber).padStart(3, '0')
  return `MASTER-${orderNo}-CASE-${paddedCaseNumber}`
}

/**
 * Batch generate QR codes for all items in an order
 */
export interface QRCodeGenerationParams {
  orderNo: string
  orderItems: Array<{
    product_id: string
    variant_id: string
    product_code: string
    variant_code: string
    product_name: string
    variant_name: string
    qty: number
  }>
  bufferPercent: number
  unitsPerCase: number
}

export interface GeneratedQRCode {
  code: string
  sequence_number: number
  product_id: string
  variant_id: string
  product_code: string
  variant_code: string
  product_name: string
  variant_name: string
  case_number: number
}

export interface GeneratedMasterCode {
  code: string
  case_number: number
  expected_unit_count: number
}

export interface QRBatchResult {
  masterCodes: GeneratedMasterCode[]
  individualCodes: GeneratedQRCode[]
  totalMasterCodes: number
  totalUniqueCodes: number
  totalBaseUnits: number
  bufferPercent: number
}

/**
 * Generate complete QR batch for an order
 */
export function generateQRBatch(params: QRCodeGenerationParams): QRBatchResult {
  const { orderNo, orderItems, bufferPercent, unitsPerCase } = params

  // Calculate total base units
  const totalBaseUnits = orderItems.reduce((sum, item) => sum + item.qty, 0)

  // Calculate total QR codes with buffer
  const totalUniqueCodes = Math.ceil(totalBaseUnits * (1 + bufferPercent / 100))

  // Calculate number of cases
  const totalMasterCodes = Math.ceil(totalUniqueCodes / unitsPerCase)

  // Generate Master QR codes for cases
  const masterCodes: GeneratedMasterCode[] = []
  for (let i = 1; i <= totalMasterCodes; i++) {
    const isLastCase = i === totalMasterCodes
    const expectedCount = isLastCase 
      ? totalUniqueCodes - ((i - 1) * unitsPerCase)
      : unitsPerCase

    masterCodes.push({
      code: generateMasterQRCode(orderNo, i),
      case_number: i,
      expected_unit_count: expectedCount
    })
  }

  // Generate individual QR codes
  const individualCodes: GeneratedQRCode[] = []
  let globalSequence = 1
  let currentCaseNumber = 1
  let codesInCurrentCase = 0

  for (const item of orderItems) {
    // Calculate quantity with buffer for this item
    const itemQtyWithBuffer = Math.ceil(item.qty * (1 + bufferPercent / 100))

    for (let i = 0; i < itemQtyWithBuffer; i++) {
      // Move to next case if current is full
      if (codesInCurrentCase >= unitsPerCase && currentCaseNumber < totalMasterCodes) {
        currentCaseNumber++
        codesInCurrentCase = 0
      }

      individualCodes.push({
        code: generateProductQRCode(
          item.product_code,
          item.variant_code,
          orderNo,
          globalSequence
        ),
        sequence_number: globalSequence,
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_code: item.product_code,
        variant_code: item.variant_code,
        product_name: item.product_name,
        variant_name: item.variant_name,
        case_number: currentCaseNumber
      })

      globalSequence++
      codesInCurrentCase++
    }
  }

  return {
    masterCodes,
    individualCodes,
    totalMasterCodes,
    totalUniqueCodes,
    totalBaseUnits,
    bufferPercent
  }
}

/**
 * Validate QR code format
 */
export function validateQRCodeFormat(code: string): boolean {
  // Product QR: PROD-{code}-{variant}-{order}-{seq}
  const productPattern = /^PROD-[A-Z0-9\-]+-[A-Z0-9\-]+-ORD-[A-Z]{2}-\d{4}-\d{2}-\d{5}$/
  
  // Master QR: MASTER-{order}-CASE-{num}
  const masterPattern = /^MASTER-ORD-[A-Z]{2}-\d{4}-\d{2}-CASE-\d{3}$/

  return productPattern.test(code) || masterPattern.test(code)
}

/**
 * Parse QR code to extract information
 */
export interface ParsedQRCode {
  type: 'product' | 'master'
  orderNo?: string
  productCode?: string
  variantCode?: string
  sequence?: number
  caseNumber?: number
}

export function parseQRCode(code: string): ParsedQRCode | null {
  if (!validateQRCodeFormat(code)) {
    return null
  }

  // Parse product QR code
  if (code.startsWith('PROD-')) {
    const parts = code.split('-')
    // PROD-{product}-{variant}-ORD-{type}-{yymm}-{seq}-{itemseq}
    return {
      type: 'product',
      productCode: parts[1],
      variantCode: parts[2],
      orderNo: `${parts[3]}-${parts[4]}-${parts[5]}-${parts[6]}`,
      sequence: parseInt(parts[7], 10)
    }
  }

  // Parse master QR code
  if (code.startsWith('MASTER-')) {
    const parts = code.split('-')
    // MASTER-ORD-{type}-{yymm}-{seq}-CASE-{num}
    return {
      type: 'master',
      orderNo: `${parts[1]}-${parts[2]}-${parts[3]}-${parts[4]}`,
      caseNumber: parseInt(parts[6], 10)
    }
  }

  return null
}
