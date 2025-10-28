/**
 * QR Code Utilities
 * Helper functions for parsing and handling QR codes
 */

/**
 * Parses a QR code string to extract order information
 * 
 * QR Code Format: PROD-{product_code}-{variant_code}-{order_no}-{sequence}
 * Example: PROD-ZEREL6829-MAN-552896-ORD-HM-1025-03-00001
 * 
 * @param qrCode - The QR code string
 * @returns Parsed QR code information
 */
export function parseQRCode(qrCode: string): {
  isValid: boolean
  productCode?: string
  variantCode?: string
  orderNo?: string
  sequence?: string
  type?: 'PRODUCT' | 'MASTER'
} {
  try {
    // Remove any whitespace
    const cleanCode = qrCode.trim()

    // Check if it's a product QR code
    if (cleanCode.startsWith('PROD-')) {
      // Format: PROD-{product_code}-{variant_code}-{order_no}-{sequence}
      const parts = cleanCode.split('-')
      
      // Find where order number starts (ORD keyword)
      const ordIndex = parts.findIndex(p => p === 'ORD')
      
      if (ordIndex === -1) {
        return { isValid: false }
      }

      // Extract components
      // PROD-ZEREL6829-MAN-552896-ORD-HM-1025-03-00001
      // [0]  [1]       [2] [3]    [4] [5][6]  [7][8]
      
      const productCode = parts[1] // ZEREL6829
      const variantCode = `${parts[2]}-${parts[3]}` // MAN-552896
      
      // Order number parts after ORD
      const orderParts = []
      for (let i = ordIndex + 1; i < parts.length - 1; i++) {
        orderParts.push(parts[i])
      }
      const orderNo = `ORD-${orderParts.join('-')}` // ORD-HM-1025-03
      
      const sequence = parts[parts.length - 1] // 00001

      return {
        isValid: true,
        type: 'PRODUCT',
        productCode,
        variantCode,
        orderNo,
        sequence
      }
    }

    // Check if it's a master QR code
    if (cleanCode.startsWith('MASTER-')) {
      // Format: MASTER-{order_no}-CASE-{case_number}
      // Example: MASTER-ORD-HM-1025-01-CASE-001
      const parts = cleanCode.split('-')
      
      const caseIndex = parts.findIndex(p => p === 'CASE')
      if (caseIndex === -1) {
        return { isValid: false }
      }

      // Extract order number
      const orderParts = parts.slice(2, caseIndex) // Skip "MASTER" and "ORD"
      const orderNo = `ORD-${orderParts.join('-')}`
      
      return {
        isValid: true,
        type: 'MASTER',
        orderNo,
        sequence: parts[caseIndex + 1] // case number
      }
    }

    return { isValid: false }
  } catch (error) {
    console.error('Error parsing QR code:', error)
    return { isValid: false }
  }
}

/**
 * Extracts order number from QR code string
 * 
 * @param qrCode - The QR code string
 * @returns Order number or null if not found
 */
export function extractOrderNumber(qrCode: string): string | null {
  const parsed = parseQRCode(qrCode)
  return parsed.isValid ? parsed.orderNo || null : null
}

/**
 * Validates if a QR code string is in correct format
 * 
 * @param qrCode - The QR code string to validate
 * @returns True if valid format
 */
export function isValidQRCode(qrCode: string): boolean {
  const parsed = parseQRCode(qrCode)
  return parsed.isValid
}

/**
 * Formats tracking URL for QR code
 * 
 * @param qrCode - The QR code string
 * @param baseUrl - Base URL (default: from env)
 * @returns Complete tracking URL
 */
export function formatTrackingURL(qrCode: string, baseUrl?: string): string {
  const base = baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://www.serapod2u.com'
  return `${base}/track/product/${qrCode}`
}

/**
 * Example usage:
 * 
 * const qrCode = "PROD-ZEREL6829-MAN-552896-ORD-HM-1025-03-00001"
 * const parsed = parseQRCode(qrCode)
 * 
 * console.log(parsed)
 * // {
 * //   isValid: true,
 * //   type: 'PRODUCT',
 * //   productCode: 'ZEREL6829',
 * //   variantCode: 'MAN-552896',
 * //   orderNo: 'ORD-HM-1025-03',
 * //   sequence: '00001'
 * // }
 * 
 * const orderNo = extractOrderNumber(qrCode)
 * console.log(orderNo) // "ORD-HM-1025-03"
 */
