/**
 * QR Verification Logger
 *
 * Internal-only module — logs every QR verification attempt with
 * structured classification for the silent recovery workflow.
 *
 * IMPORTANT: Nothing from this module is ever shown to consumers.
 * The trust_level / recovery fields are purely operational.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { parseProductQr } from '@/lib/qr-parser'
import { extractQRCodeParts, validateQRHash } from '@/lib/security/qr-hash'
import { parseQRCode } from '@/lib/qr-code-utils'

// ── Internal Classification Types ────────────────────────────────

export type ShapeStatus = 'valid_product' | 'valid_master' | 'invalid'
export type LookupResult = 'exact_match' | 'base_code_match' | 'pattern_match' | 'not_found' | 'db_error'
export type HashStatus = 'valid' | 'invalid' | 'missing' | 'legacy' | 'skipped'

export type TrustLevel =
  | 'exact_match'            // code found + hash valid → full trust
  | 'recovered_match'        // resolved via fallback → high trust
  | 'valid_shape_unresolved' // valid format + valid hash but missing from DB
  | 'valid_shape_bad_hash'   // valid format but hash mismatch
  | 'invalid_shape'          // not a recognized QR format

export type UserFacingOutcome =
  | 'genuine'                // normal success flow
  | 'already_collected'      // points already awarded
  | 'not_activated'          // product still in warehouse/mfg
  | 'temporarily_unavailable'// neutral message for unresolved
  | 'invalid_code'           // clearly invalid format
  | 'error'                  // 500 / unexpected failure

export type PointsOutcome =
  | 'awarded'
  | 'already_awarded'
  | 'blocked'
  | 'not_applicable'
  | 'pending'

export type RecoveryStatus = 'none' | 'pending' | 'resolved' | 'rejected'

export interface VerificationLogEntry {
  raw_code: string
  source_url?: string | null

  // Parsed fields
  parsed_product_sku?: string | null
  parsed_variant_code?: string | null
  parsed_order_no?: string | null
  parsed_sequence?: number | null
  parsed_hash_suffix?: string | null

  // Classifications
  shape_status: ShapeStatus
  lookup_result: LookupResult
  hash_status: HashStatus
  trust_level: TrustLevel

  // DB context
  qr_code_id?: string | null
  order_id?: string | null
  order_exists?: boolean
  qr_exists?: boolean

  // Outcome
  user_facing_outcome: UserFacingOutcome
  points_outcome: PointsOutcome

  // Recovery
  is_recovery_candidate: boolean
  recovery_status: RecoveryStatus

  // Actor
  consumer_phone?: string | null
  consumer_name?: string | null
  shop_id?: string | null
  org_id?: string | null
  ip_address?: string | null
  user_agent?: string | null

  // Testing
  is_test_data?: boolean
  test_actor?: string | null
  notes?: string | null
}

// ── Classification Logic ─────────────────────────────────────────

/**
 * Classify/parse a raw QR code string into internal fields.
 * This is the first step — before any DB lookup.
 */
export function classifyQRShape(rawCode: string): {
  shapeStatus: ShapeStatus
  parsedProductSku: string | null
  parsedVariantCode: string | null
  parsedOrderNo: string | null
  parsedSequence: number | null
  parsedHashSuffix: string | null
} {
  // Try product QR parse
  const productParsed = parseProductQr(rawCode)
  if (productParsed) {
    const parts = extractQRCodeParts(rawCode)
    return {
      shapeStatus: 'valid_product',
      parsedProductSku: productParsed.productSku,
      parsedVariantCode: productParsed.variantCode,
      parsedOrderNo: productParsed.orderNo,
      parsedSequence: productParsed.sequenceNumber,
      parsedHashSuffix: parts?.hash ?? null,
    }
  }

  // Try master QR parse (via the more permissive parseQRCode)
  const genericParsed = parseQRCode(rawCode)
  if (genericParsed.isValid && genericParsed.type === 'MASTER') {
    return {
      shapeStatus: 'valid_master',
      parsedProductSku: null,
      parsedVariantCode: null,
      parsedOrderNo: genericParsed.orderNo ?? null,
      parsedSequence: null,
      parsedHashSuffix: extractQRCodeParts(rawCode)?.hash ?? null,
    }
  }

  // Also allow generic product parse fallback (parseQRCode is more lenient)
  if (genericParsed.isValid && genericParsed.type === 'PRODUCT') {
    const parts = extractQRCodeParts(rawCode)
    return {
      shapeStatus: 'valid_product',
      parsedProductSku: genericParsed.productCode ?? null,
      parsedVariantCode: genericParsed.variantCode ?? null,
      parsedOrderNo: genericParsed.orderNo ?? null,
      parsedSequence: genericParsed.sequence ? parseInt(genericParsed.sequence, 10) : null,
      parsedHashSuffix: parts?.hash ?? null,
    }
  }

  return {
    shapeStatus: 'invalid',
    parsedProductSku: null,
    parsedVariantCode: null,
    parsedOrderNo: null,
    parsedSequence: null,
    parsedHashSuffix: null,
  }
}

/**
 * Derive the composite trust level from shape + lookup + hash results.
 */
export function deriveTrustLevel(
  shapeStatus: ShapeStatus,
  lookupResult: LookupResult,
  hashStatus: HashStatus
): TrustLevel {
  if (shapeStatus === 'invalid') return 'invalid_shape'

  // Code found in DB
  if (lookupResult === 'exact_match' || lookupResult === 'base_code_match') {
    if (hashStatus === 'valid' || hashStatus === 'legacy' || hashStatus === 'missing') {
      return 'exact_match'
    }
    // Hash mismatch but record found — suspicious
    return 'valid_shape_bad_hash'
  }

  // Fallback/pattern match
  if (lookupResult === 'pattern_match') {
    return 'recovered_match'
  }

  // Not found in DB
  if (lookupResult === 'not_found') {
    if (hashStatus === 'valid') return 'valid_shape_unresolved'
    if (hashStatus === 'invalid') return 'valid_shape_bad_hash'
    return 'valid_shape_unresolved' // hash missing/skipped but valid shape
  }

  return 'invalid_shape'
}

/**
 * Determine hash validation status for a code.
 * Runs HMAC validation independently of DB lookup.
 */
export function classifyHash(rawCode: string, shapeStatus: ShapeStatus): HashStatus {
  if (shapeStatus === 'invalid') return 'skipped'

  const parts = extractQRCodeParts(rawCode)
  if (!parts) return 'missing'

  const isValid = validateQRHash(rawCode)
  return isValid ? 'valid' : 'invalid'
}

// ── Persistence ──────────────────────────────────────────────────

/**
 * Write a verification log entry to the database.
 * Fire-and-forget — errors are logged but never block the API response.
 */
export async function writeVerificationLog(
  supabaseAdmin: SupabaseClient,
  entry: VerificationLogEntry
): Promise<void> {
  try {
    const { error } = await (supabaseAdmin as any)
      .from('qr_verification_log')
      .insert({
        raw_code: entry.raw_code,
        source_url: entry.source_url,
        parsed_product_sku: entry.parsed_product_sku,
        parsed_variant_code: entry.parsed_variant_code,
        parsed_order_no: entry.parsed_order_no,
        parsed_sequence: entry.parsed_sequence,
        parsed_hash_suffix: entry.parsed_hash_suffix,
        shape_status: entry.shape_status,
        lookup_result: entry.lookup_result,
        hash_status: entry.hash_status,
        trust_level: entry.trust_level,
        qr_code_id: entry.qr_code_id,
        order_id: entry.order_id,
        order_exists: entry.order_exists ?? false,
        qr_exists: entry.qr_exists ?? false,
        user_facing_outcome: entry.user_facing_outcome,
        points_outcome: entry.points_outcome,
        is_recovery_candidate: entry.is_recovery_candidate,
        recovery_status: entry.is_recovery_candidate ? 'pending' : 'none',
        consumer_phone: entry.consumer_phone,
        consumer_name: entry.consumer_name,
        shop_id: entry.shop_id,
        org_id: entry.org_id,
        ip_address: entry.ip_address,
        user_agent: entry.user_agent,
        is_test_data: entry.is_test_data ?? false,
        test_actor: entry.test_actor,
        notes: entry.notes,
      })

    if (error) {
      console.error('⚠️ [VerificationLog] Failed to write log:', error.message)
    }
  } catch (err) {
    // Never let logging failures affect the user
    console.error('⚠️ [VerificationLog] Unexpected error:', err)
  }
}
