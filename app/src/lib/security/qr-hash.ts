/**
 * QR Code Security - HMAC Hash Implementation
 * 
 * This module provides cryptographic security for QR codes to prevent:
 * - Sequential code guessing
 * - Unauthorized point farming
 * - Code tampering
 * 
 * Implementation: HMAC-SHA256 with 12-character suffix
 * Format: ORIGINAL_CODE-HASH
 * Example: PROD-VAPE001-MINT-ORD-HM-1025-01-00017-a3f9c8d2e1b4
 */

import crypto from 'crypto'

/**
 * Secret key for HMAC generation
 * CRITICAL: Keep this secret! Store in environment variable in production
 * For local testing, we use a default key
 */
const QR_HASH_SECRET = process.env.QR_HASH_SECRET || 'serapod2u-qr-security-key-2025'

/**
 * Hash length in characters
 */
const HASH_LENGTH = 12

/**
 * Generate HMAC-SHA256 hash for a QR code
 * 
 * @param qrCode - The original QR code without hash
 * @returns The hash string (12 characters)
 */
export function generateQRHash(qrCode: string): string {
  // Create HMAC-SHA256 hash
  const hmac = crypto.createHmac('sha256', QR_HASH_SECRET)
  hmac.update(qrCode)
  const fullHash = hmac.digest('hex')
  
  // Take first 12 characters for compact representation
  return fullHash.substring(0, HASH_LENGTH)
}

/**
 * Generate complete QR code with hash suffix
 * 
 * @param baseCode - The original QR code without hash
 * @returns Complete QR code with hash appended (ORIGINAL-HASH)
 */
export function generateSecureQRCode(baseCode: string): string {
  const hash = generateQRHash(baseCode)
  return `${baseCode}-${hash}`
}

/**
 * Extract base code and hash from a complete QR code
 * 
 * @param secureCode - The complete QR code with hash
 * @returns Object containing baseCode and hash, or null if invalid format
 */
export function extractQRCodeParts(secureCode: string): {
  baseCode: string
  hash: string
} | null {
  // Check if code has hash suffix (must end with -XXXXXXXXXXXX where X is hex)
  const hashPattern = new RegExp(`-([0-9a-f]{${HASH_LENGTH}})$`, 'i')
  const match = secureCode.match(hashPattern)
  
  if (!match) {
    return null
  }
  
  const hash = match[1]
  const baseCode = secureCode.substring(0, secureCode.length - HASH_LENGTH - 1)
  
  return { baseCode, hash }
}

/**
 * Validate QR code hash
 * 
 * @param secureCode - The complete QR code with hash
 * @returns true if hash is valid, false otherwise
 */
export function validateQRHash(secureCode: string): boolean {
  const parts = extractQRCodeParts(secureCode)
  
  if (!parts) {
    // No hash found - this might be an old code (backward compatibility)
    return false
  }
  
  const { baseCode, hash } = parts
  const expectedHash = generateQRHash(baseCode)
  
  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(hash.toLowerCase()),
    Buffer.from(expectedHash.toLowerCase())
  )
}

/**
 * Check if QR code has hash suffix
 * Used to determine if code is old (no hash) or new (with hash)
 * 
 * @param qrCode - The QR code to check
 * @returns true if code has hash suffix
 */
export function hasQRHash(qrCode: string): boolean {
  const hashPattern = new RegExp(`-([0-9a-f]{${HASH_LENGTH}})$`, 'i')
  return hashPattern.test(qrCode)
}

/**
 * Get base code from QR (removes hash if present)
 * 
 * @param qrCode - QR code with or without hash
 * @returns Base code without hash
 */
export function getBaseCode(qrCode: string): string {
  const parts = extractQRCodeParts(qrCode)
  return parts ? parts.baseCode : qrCode
}

/**
 * Validation result interface
 */
export interface QRHashValidationResult {
  isValid: boolean
  hasHash: boolean
  reason?: string
  baseCode: string
}

/**
 * Comprehensive QR code validation
 * Handles both old codes (no hash) and new codes (with hash)
 * 
 * @param qrCode - The QR code to validate
 * @param allowLegacyCodes - Whether to allow codes without hash (default: true)
 * @returns Validation result with details
 */
export function validateQRCodeSecurity(
  qrCode: string,
  allowLegacyCodes: boolean = true
): QRHashValidationResult {
  const codeHasHash = hasQRHash(qrCode)
  
  if (!codeHasHash) {
    // Old code without hash
    if (allowLegacyCodes) {
      return {
        isValid: true,
        hasHash: false,
        reason: 'Legacy code without hash (backward compatibility)',
        baseCode: qrCode
      }
    } else {
      return {
        isValid: false,
        hasHash: false,
        reason: 'Code does not have required security hash',
        baseCode: qrCode
      }
    }
  }
  
  // New code with hash - validate it
  const isHashValid = validateQRHash(qrCode)
  const parts = extractQRCodeParts(qrCode)
  
  if (!isHashValid) {
    return {
      isValid: false,
      hasHash: true,
      reason: 'Invalid or tampered security hash',
      baseCode: parts?.baseCode || qrCode
    }
  }
  
  return {
    isValid: true,
    hasHash: true,
    reason: 'Valid security hash',
    baseCode: parts!.baseCode
  }
}

/**
 * Generate hash for existing QR code in database
 * Used for migration script
 * 
 * @param existingCode - Existing QR code without hash
 * @returns The hash to store in qr_hash column
 */
export function generateHashForMigration(existingCode: string): string {
  return generateQRHash(existingCode)
}

/**
 * Test utility - generate sample codes for testing
 */
export function generateSampleSecureCodes(count: number = 5): Array<{
  baseCode: string
  secureCode: string
  hash: string
}> {
  const samples = []
  
  for (let i = 1; i <= count; i++) {
    const baseCode = `PROD-TEST-SAMPLE-ORD-TEST-001-${String(i).padStart(5, '0')}`
    const hash = generateQRHash(baseCode)
    const secureCode = `${baseCode}-${hash}`
    
    samples.push({ baseCode, secureCode, hash })
  }
  
  return samples
}
