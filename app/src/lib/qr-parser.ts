/**
 * QR Code Parsing Utilities for Mode C
 * 
 * Handles parsing of product QR codes and master case QR codes
 * to extract variant keys, sequence numbers, and case numbers.
 */

export interface ProductQRData {
  prefix: string          // "PROD"
  productSku: string      // e.g., "CELVA9464"
  variantCode: string     // e.g., "CRA-843412", "KEL-866575", "MAN-800479"
  variantKey: string      // Full key: "PROD-CELVA9464-CRA-843412" (for database queries)
  orderNo: string         // e.g., "ORD-HM-1125-06"
  sequenceNumber: number  // e.g., 1, 52, 101
  fullCode: string
}

export interface MasterQRData {
  caseNumber: number
  orderNo: string
  fullCode: string
}

export interface SpoiledEntry {
  type: 'qr' | 'sequence'
  value: string
  parsed?: {
    variantKey?: string
    sequenceNumber?: number
    orderNo?: string
  }
}

/**
 * Parse a product QR code string
 * 
 * Format: PROD-{ProductSKU}-{VariantCode}-{OrderNo}-{Sequence}-{Hash}
 * 
 * Example input: "PROD-CELVA9464-CRA-843412-ORD-HM-1125-06-00001-9465a7b8d277"
 * Returns: {
 *   prefix: "PROD",
 *   productSku: "CELVA9464",
 *   variantCode: "CRA-843412",
 *   variantKey: "PROD-CELVA9464-CRA-843412",
 *   orderNo: "ORD-HM-1125-06",
 *   sequenceNumber: 1,
 *   fullCode: "PROD-CELVA9464-CRA-843412-ORD-HM-1125-06-00001-9465a7b8d277"
 * }
 * 
 * Supports variants like: CRA-843412, KEL-866575, MAN-800479, etc.
 */
export function parseProductQr(code: string): ProductQRData | null {
  if (!code || typeof code !== 'string') {
    return null
  }

  const trimmed = code.trim()

  // Fixed format: PROD-{ProductSKU}-{VariantCode}-ORD-{order}-{batch}-{sequence}-{hash}
  // Examples: 
  //   PROD-CELVA9464-CRA-843412-ORD-HM-1125-06-00001-9465a7b8d277
  //   PROD-CELVA9464-KEL-866575-ORD-HM-1125-06-00052-8eea4f6dbe59
  //   PROD-CELVA9464-MAN-800479-ORD-HM-1125-06-00101-5cda611b5e01
  // 
  // Pattern breakdown:
  // - (PROD) = prefix (group 1)
  // - ([^-]+) = productSku (group 2)
  // - ([^-]+-[^-]+) = variantCode, can contain one hyphen (group 3)
  // - (ORD-[^-]+-[^-]+-[^-]+) = orderNo (group 4)
  // - (\d{5}) = sequence, exactly 5 digits (group 5)
  // - (?:-[a-f0-9]+)? = optional hash (not captured)
  const productRegex = /^(PROD)-([^-]+)-([^-]+-[^-]+)-(ORD-[^-]+-[^-]+-[^-]+)-(\d{5})(?:-[a-f0-9]+)?$/i

  const match = trimmed.match(productRegex)

  if (!match) {
    return null
  }

  const prefix = match[1]       // PROD
  const productSku = match[2]   // CELVA9464
  const variantCode = match[3]  // CRA-843412, KEL-866575, MAN-800479
  const orderNo = match[4]      // ORD-HM-1125-06
  const sequenceStr = match[5]  // 00001, 00052, 00101

  // Build variantKey for database queries: PROD-{ProductSKU}-{VariantCode}
  const variantKey = `${prefix}-${productSku}-${variantCode}`

  return {
    prefix,
    productSku,
    variantCode,
    variantKey,
    orderNo,
    sequenceNumber: parseInt(sequenceStr, 10),
    fullCode: trimmed
  }
}

/**
 * Parse a master case QR code string
 * 
 * Example input: "MASTER-ORD-HM-1125-02-CASE-001-8c12f41ab98f"
 * Returns: {
 *   caseNumber: 1,
 *   orderNo: "ORD-HM-1125-02",
 *   fullCode: "MASTER-ORD-HM-1125-02-CASE-001-8c12f41ab98f"
 * }
 */
export function parseMasterQr(code: string): MasterQRData | null {
  if (!code || typeof code !== 'string') {
    return null
  }

  const trimmed = code.trim()

  // Match pattern: MASTER-ORD-{order}-CASE-{number}-{hash}
  // Example: MASTER-ORD-HM-1125-02-CASE-001-8c12f41ab98f
  const masterRegex = /^MASTER-(ORD-[^-]+-[^-]+-[^-]+)-CASE-(\d{3})(?:-[a-f0-9]+)?$/i

  const match = trimmed.match(masterRegex)

  if (!match) {
    return null
  }

  const orderNo = match[1]      // ORD-HM-1125-02
  const caseNumberStr = match[2] // 001

  return {
    caseNumber: parseInt(caseNumberStr, 10), // 1
    orderNo,
    fullCode: trimmed
  }
}

/**
 * Extract variant key from a product QR code
 * This is the TypeScript equivalent of the SQL function extract_variant_key_from_code()
 * 
 * Example: "PROD-CELVA9464-CRA-843412-ORD-..." → "PROD-CELVA9464-CRA-843412"
 */
export function extractVariantKey(code: string): string | null {
  if (!code || typeof code !== 'string') {
    return null
  }

  // Extract variant key using regex
  const match = code.match(/^(PROD-[^-]+-[^-]+-[^-]+)/)

  return match ? match[1] : null
}

/**
 * Parse a spoiled entry (either a full QR code or just a sequence number)
 * 
 * Examples:
 * - "PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00015-abc123" → type: qr
 * - "18" → type: sequence
 * - "SEQ:18" → type: sequence
 * - "  42  " → type: sequence
 */
export function parseSpoiledEntry(entry: string): SpoiledEntry | null {
  if (!entry || typeof entry !== 'string') {
    return null
  }

  const trimmed = entry.trim()

  if (!trimmed) {
    return null
  }

  // Check if it's a full QR code (starts with PROD-)
  if (trimmed.startsWith('PROD-')) {
    const parsed = parseProductQr(trimmed)

    if (parsed) {
      return {
        type: 'qr',
        value: trimmed,
        parsed: {
          variantKey: parsed.variantKey,
          sequenceNumber: parsed.sequenceNumber,
          orderNo: parsed.orderNo
        }
      }
    }

    // If it starts with PROD- but doesn't parse, it's invalid
    return null
  }

  // Check if it's a tracking URL
  if (trimmed.includes('serapod2u.com/track/product/')) {
    // Extract the product code from URL
    // Example: http://serapod2u.com/track/product/PROD-CELVA9464-CRA-843412-ORD-HM-1125-02-00015
    const urlMatch = trimmed.match(/\/track\/product\/(PROD-.+?)(?:[?#]|$)/i)

    if (urlMatch) {
      const productCode = urlMatch[1]
      const parsed = parseProductQr(productCode)

      if (parsed) {
        return {
          type: 'qr',
          value: productCode,
          parsed: {
            variantKey: parsed.variantKey,
            sequenceNumber: parsed.sequenceNumber,
            orderNo: parsed.orderNo
          }
        }
      }
    }

    return null
  }

  // Check if it's a sequence number (with or without "SEQ:" prefix)
  const seqMatch = trimmed.match(/^(?:SEQ:)?(\d+)$/i)

  if (seqMatch) {
    const sequenceNumber = parseInt(seqMatch[1], 10)

    if (isNaN(sequenceNumber) || sequenceNumber < 1) {
      return null
    }

    return {
      type: 'sequence',
      value: trimmed,
      parsed: {
        sequenceNumber
      }
    }
  }

  // Not a recognized format
  return null
}

/**
 * Parse multiple lines of spoiled entries
 * Returns array of successfully parsed entries and array of errors
 */
export function parseSpoiledEntries(input: string): {
  entries: SpoiledEntry[]
  errors: string[]
} {
  if (!input || typeof input !== 'string') {
    return { entries: [], errors: [] }
  }

  const lines = input
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)

  const entries: SpoiledEntry[] = []
  const errors: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const parsed = parseSpoiledEntry(line)

    if (parsed) {
      entries.push(parsed)
    } else {
      errors.push(`Line ${i + 1}: Could not parse "${line}"`)
    }
  }

  return { entries, errors }
}

/**
 * Validate that all spoiled entries belong to the same case and variant
 * Returns validation result with case number and variant key, or errors
 * @deprecated Use groupSpoiledEntriesByCase for multi-case support
 */
export function validateSpoiledEntriesSameCase(
  entries: SpoiledEntry[],
  unitsPerCase: number
): {
  valid: boolean
  caseNumber?: number
  variantKey?: string
  errors: string[]
} {
  if (entries.length === 0) {
    return {
      valid: false,
      errors: ['No entries to validate']
    }
  }

  const errors: string[] = []
  let caseNumber: number | undefined
  let variantKey: string | undefined

  // Split entries into normal codes and buffer codes
  // Buffer codes are those with sequence > total expected codes (normal + buffer)
  // For a batch with 3000 normal + 300 buffer = 3300 total
  // Normal codes: 1-3000, Buffer codes: 3001-3300
  const totalExpectedCodes = unitsPerCase * Math.ceil(entries.length / unitsPerCase) * 1.1 // Rough estimate

  for (const entry of entries) {
    if (entry.type === 'qr' && entry.parsed) {
      const sequenceNumber = entry.parsed.sequenceNumber!

      // Determine if this is likely a buffer code
      // Buffer codes are typically in a separate sequence range (e.g., 3001+)
      // We'll consider codes as buffer if they're > (unitsPerCase * 30)
      // For 100 units/case: max normal = 3000 (30 cases), buffer starts at 3001
      const maxNormalSequence = unitsPerCase * 30 // Assume max 30 cases for normal codes
      const isBufferCode = sequenceNumber > maxNormalSequence

      // Only validate case numbers for NORMAL codes, not buffer codes
      if (!isBufferCode) {
        // Calculate case number from sequence
        const entryCase = Math.ceil(sequenceNumber / unitsPerCase)

        if (caseNumber === undefined) {
          caseNumber = entryCase
        } else if (caseNumber !== entryCase) {
          errors.push(
            `Sequence ${sequenceNumber} belongs to case ${entryCase}, but expected case ${caseNumber}`
          )
        }
      }

      // Check variant key consistency for ALL codes (normal and buffer must match)
      if (variantKey === undefined) {
        variantKey = entry.parsed.variantKey
      } else if (entry.parsed.variantKey && variantKey !== entry.parsed.variantKey) {
        errors.push(
          `Sequence ${sequenceNumber} has variant ${entry.parsed.variantKey}, but expected ${variantKey}`
        )
      }
    } else if (entry.type === 'sequence' && entry.parsed) {
      const sequenceNumber = entry.parsed.sequenceNumber!

      // Same logic for sequence-only entries
      const maxNormalSequence = unitsPerCase * 30 // Match the threshold above
      const isBufferCode = sequenceNumber > maxNormalSequence

      if (!isBufferCode) {
        // For sequence-only entries, calculate case number
        const entryCase = Math.ceil(sequenceNumber / unitsPerCase)

        if (caseNumber === undefined) {
          caseNumber = entryCase
        } else if (caseNumber !== entryCase) {
          errors.push(
            `Sequence ${sequenceNumber} belongs to case ${entryCase}, but expected case ${caseNumber}`
          )
        }
      }
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors
    }
  }

  // If no case number was determined (all codes were buffer codes), use case 1 as default
  if (caseNumber === undefined) {
    caseNumber = 1
  }

  return {
    valid: true,
    caseNumber,
    variantKey,
    errors: []
  }
}

/**
 * Groups spoiled entries by case number, supporting mixed-case submissions
 * This allows users to scan codes from multiple cases in one submission
 * Each case group will be processed as a separate Mode C job
 * 
 * @param entries - Array of spoiled entries (QR codes or sequence numbers)
 * @param unitsPerCase - Number of units per case (e.g., 100)
 * @returns Map of case numbers to their entries and metadata, or error details
 * 
 * @example
 * Input: [seq 5, seq 10, seq 55, seq 65, seq 110]
 * Output: {
 *   1: { entries: [seq 5, seq 10], variantKey: 'CRA-843412', sequences: [5, 10] },
 *   2: { entries: [seq 55, seq 65], variantKey: 'CRA-843412', sequences: [55, 65] },
 *   3: { entries: [seq 110], variantKey: 'CRA-843412', sequences: [110] }
 * }
 */
export function groupSpoiledEntriesByCase(
  entries: SpoiledEntry[],
  unitsPerCase: number
): {
  success: boolean
  groups?: Map<number, {
    entries: SpoiledEntry[]
    variantKey?: string
    sequences: number[]
  }>
  errors?: string[]
} {
  if (entries.length === 0) {
    return {
      success: false,
      errors: ['No entries to group']
    }
  }

  const errors: string[] = []
  const caseGroups = new Map<number, {
    entries: SpoiledEntry[]
    variantKey?: string
    sequences: number[]
  }>()

  // Track variant keys per case to ensure consistency within each case
  const caseVariantKeys = new Map<number, string>()

  // Maximum sequence for normal codes (buffer codes are beyond this)
  const maxNormalSequence = unitsPerCase * 30 // Assume max 30 cases for normal codes

  for (const entry of entries) {
    let sequenceNumber: number | undefined
    let entryVariantKey: string | undefined

    // Extract sequence number and variant key
    if (entry.type === 'qr' && entry.parsed) {
      sequenceNumber = entry.parsed.sequenceNumber
      entryVariantKey = entry.parsed.variantKey
    } else if (entry.type === 'sequence' && entry.parsed) {
      sequenceNumber = entry.parsed.sequenceNumber
    }

    if (!sequenceNumber) {
      errors.push(`Invalid entry: missing sequence number`)
      continue
    }

    // Determine if this is a buffer code
    const isBufferCode = sequenceNumber > maxNormalSequence

    if (isBufferCode) {
      errors.push(
        `Sequence ${sequenceNumber} appears to be a buffer code (> ${maxNormalSequence}). ` +
        `Only normal product codes should be submitted for Mode C replacement.`
      )
      continue
    }

    // Calculate case number from sequence
    const caseNumber = Math.ceil(sequenceNumber / unitsPerCase)

    // Check variant key consistency within this case
    if (entryVariantKey) {
      const existingVariantKey = caseVariantKeys.get(caseNumber)
      if (existingVariantKey && existingVariantKey !== entryVariantKey) {
        errors.push(
          `Case ${caseNumber}: Variant mismatch - sequence ${sequenceNumber} has variant ${entryVariantKey}, ` +
          `but case already has variant ${existingVariantKey}`
        )
        continue
      }
      caseVariantKeys.set(caseNumber, entryVariantKey)
    }

    // Add entry to case group
    if (!caseGroups.has(caseNumber)) {
      caseGroups.set(caseNumber, {
        entries: [],
        variantKey: entryVariantKey,
        sequences: []
      })
    }

    const group = caseGroups.get(caseNumber)!
    group.entries.push(entry)
    group.sequences.push(sequenceNumber)

    // Update variant key if this is the first one for this case
    if (entryVariantKey && !group.variantKey) {
      group.variantKey = entryVariantKey
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      errors
    }
  }

  if (caseGroups.size === 0) {
    return {
      success: false,
      errors: ['No valid entries found after grouping']
    }
  }

  return {
    success: true,
    groups: caseGroups
  }
}
