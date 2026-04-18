/**
 * QR Code Resolution Utility
 * 
 * Safely resolves QR code records from database, handling both:
 * - New codes with hash suffix (PROD-XXX-hash)
 * - Legacy codes without hash (PROD-XXX)
 * 
 * Prevents ".single() cannot coerce multiple rows" errors by:
 * 1. First trying exact match with full code (including hash)
 * 2. Then falling back to base code (without hash) for legacy codes
 * 3. Using maybeSingle() to handle 0 or 1 row results safely
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { getBaseCode } from '@/lib/security/qr-hash'

/**
 * QR code record interface
 */
export interface QRCodeRecord {
  id: string
  code: string
  company_id?: string
  order_id?: string
  product_id?: string
  variant_id?: string
  status?: string
}

export interface PointsBalanceContext {
  userId?: string | null
  roleCode?: string | null
  organizationId?: string | null
}

export interface ResolvedPointsBalance {
  balance: number
  source: 'consumer_view' | 'consumer_ledger' | 'consumer_scans' | 'shop_view' | 'shop_ledger_shop' | 'shop_ledger_consumer' | 'shop_scans' | 'consumer_scans_fallback' | 'none'
  scope: 'consumer' | 'shop'
}

const CONSUMER_SCOPED_ROLE_CODES = new Set(['GUEST', 'CONSUMER', 'USER'])

export function isConsumerScopedRole(roleCode?: string | null): boolean {
  return CONSUMER_SCOPED_ROLE_CODES.has((roleCode || '').toUpperCase())
}

/**
 * Resolve QR code record from database
 * 
 * Strategy:
 * 1. Try exact match with full code (for new codes with hash)
 * 2. Fallback to base code (for legacy codes without hash)
 * 3. Return null if not found in either format
 * 
 * @param supabase - Supabase client instance
 * @param qr_code - The scanned QR code (with or without hash)
 * @returns QR code record or null if not found
 * @throws Error on unexpected database errors (not PGRST116)
 */
export async function resolveQrCodeRecord(
  supabase: SupabaseClient,
  qr_code: string
): Promise<QRCodeRecord | null> {
  console.log('🔍 Resolving QR code:', qr_code)

  // Extract base code (remove hash suffix if present)
  const baseCode = getBaseCode(qr_code)
  console.log('📋 Base code (without hash):', baseCode)

  // Step 1: Try exact match with full code (including hash if present)
  const { data: fullCodeMatch, error: fullCodeError } = await supabase
    .from('qr_codes')
    .select('id, code, company_id, order_id, product_id, variant_id, status, is_lucky_draw_entered')
    .eq('code', qr_code)
    .maybeSingle()

  // Handle unexpected errors (not "no rows" - PGRST116)
  if (fullCodeError && fullCodeError.code !== 'PGRST116') {
    console.error('❌ Unexpected database error on full code lookup:', fullCodeError)
    throw new Error(`Database error: ${fullCodeError.message}`)
  }

  if (fullCodeMatch) {
    console.log('✅ Found match with full code:', fullCodeMatch.code)
    return fullCodeMatch
  }

  console.log('⚠️ No match with full code, trying base code...')

  // Step 2: Fallback to base code (for legacy codes without hash)
  // Only try base code if it's different from the full code
  if (baseCode === qr_code) {
    // They're the same, so we already tried it above
    console.log('❌ QR code not found (base code same as full code)')
    return null
  }

  const { data: baseCodeMatch, error: baseCodeError } = await supabase
    .from('qr_codes')
    .select('id, code, company_id, order_id, product_id, variant_id, status, is_lucky_draw_entered')
    .eq('code', baseCode)
    .maybeSingle()

  // Handle unexpected errors
  if (baseCodeError && baseCodeError.code !== 'PGRST116') {
    console.error('❌ Unexpected database error on base code lookup:', baseCodeError)
    throw new Error(`Database error: ${baseCodeError.message}`)
  }

  if (baseCodeMatch) {
    console.log('✅ Found match with base code (legacy):', baseCodeMatch.code)
    return baseCodeMatch
  }

  // Step 3: Try pattern match for truncated URLs (missing last 2 characters)
  // This handles cases where security truncation removed characters
  console.log('⚠️ No match with base code, trying pattern match for truncated URL...')

  const { data: patternMatch, error: patternError } = await supabase
    .from('qr_codes')
    .select('id, code, company_id, order_id, product_id, variant_id, status, is_lucky_draw_entered')
    .like('code', `${qr_code}__`)
    .maybeSingle()

  if (patternError && patternError.code !== 'PGRST116') {
    console.error('❌ Unexpected database error on pattern lookup:', patternError)
    // Don't throw here, just log - we'll return null
  }

  if (patternMatch) {
    console.log('✅ Found match with pattern (truncated URL):', patternMatch.code)
    return patternMatch
  }

  // Step 4: Not found in any format
  console.log('❌ QR code not found in database')
  return null
}

/**
 * Check if points have already been collected for a QR code
 * 
 * @param supabase - Supabase client instance
 * @param qr_code_id - The QR code database ID
 * @returns Collection record or null if not collected
 * @throws Error on unexpected database errors
 */
export async function checkPointsCollected(
  supabase: SupabaseClient,
  qr_code_id: string
): Promise<{
  id: string
  consumer_id: string | null
  points_amount: number | null
  points_collected_at: string | null
  shop_id: string | null
  claim_lane?: string | null
} | null> {
  const { data: collectionRecord, error } = await supabase
    .from('consumer_qr_scans')
    .select('id, consumer_id, points_amount, points_collected_at, shop_id, claim_lane')
    .eq('qr_code_id', qr_code_id)
    .eq('collected_points', true)
    .order('points_collected_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Handle unexpected errors (not "no rows" - PGRST116)
  if (error && error.code !== 'PGRST116') {
    console.error('❌ Unexpected database error checking collection status:', error)
    throw new Error(`Database error: ${error.message}`)
  }

  return collectionRecord
}

async function resolveConsumerPointsBalance(
  supabase: SupabaseClient,
  userId: string
): Promise<ResolvedPointsBalance> {
  const { data: consumerBalance, error: consumerViewError } = await supabase
    .from('v_consumer_points_balance')
    .select('current_balance')
    .eq('user_id', userId)
    .maybeSingle()

  if (!consumerViewError && consumerBalance?.current_balance !== undefined && consumerBalance?.current_balance !== null) {
    return {
      balance: Number(consumerBalance.current_balance || 0),
      source: 'consumer_view',
      scope: 'consumer',
    }
  }

  if (consumerViewError) {
    console.warn(`⚠️ Error fetching consumer balance from view for ${userId}:`, consumerViewError)
  }

  const { data: ledgerRows, error: ledgerError } = await supabase
    .from('shop_points_ledger')
    .select('points_change')
    .eq('consumer_id', userId)

  if (!ledgerError && ledgerRows && ledgerRows.length > 0) {
    return {
      balance: ledgerRows.reduce((sum, row) => sum + (row.points_change || 0), 0),
      source: 'consumer_ledger',
      scope: 'consumer',
    }
  }

  if (ledgerError) {
    console.warn(`⚠️ Error fetching consumer ledger balance for ${userId}:`, ledgerError)
  }

  const { data: scanRows, error: scanError } = await supabase
    .from('consumer_qr_scans')
    .select('points_amount')
    .eq('consumer_id', userId)
    .eq('collected_points', true)

  if (!scanError && scanRows && scanRows.length > 0) {
    return {
      balance: scanRows.reduce((sum, row) => sum + (row.points_amount || 0), 0),
      source: 'consumer_scans',
      scope: 'consumer',
    }
  }

  if (scanError) {
    console.warn(`⚠️ Error fetching consumer scan balance for ${userId}:`, scanError)
  }

  return { balance: 0, source: 'none', scope: 'consumer' }
}

async function resolveShopPointsBalance(
  supabase: SupabaseClient,
  shopId: string
): Promise<ResolvedPointsBalance> {
  const { data: balance, error: viewError } = await supabase
    .from('v_shop_points_balance')
    .select('current_balance')
    .eq('shop_id', shopId)
    .maybeSingle()

  if (!viewError && balance) {
    return {
      balance: Number(balance.current_balance || 0),
      source: 'shop_view',
      scope: 'shop',
    }
  }

  if (viewError) {
    console.warn('⚠️ Error fetching balance from view, falling back to ledger sum:', viewError)
  }

  const { data: ledgerByShop, error: ledgerShopError } = await supabase
    .from('shop_points_ledger')
    .select('points_change')
    .eq('shop_id', shopId)

  if (!ledgerShopError && ledgerByShop && ledgerByShop.length > 0) {
    return {
      balance: ledgerByShop.reduce((sum, row) => sum + (row.points_change || 0), 0),
      source: 'shop_ledger_shop',
      scope: 'shop',
    }
  }

  const { data: ledgerByConsumer, error: ledgerConsumerError } = await supabase
    .from('shop_points_ledger')
    .select('points_change')
    .eq('consumer_id', shopId)

  if (!ledgerConsumerError && ledgerByConsumer && ledgerByConsumer.length > 0) {
    return {
      balance: ledgerByConsumer.reduce((sum, row) => sum + (row.points_change || 0), 0),
      source: 'shop_ledger_consumer',
      scope: 'shop',
    }
  }

  const { data: shopScans, error: shopError } = await supabase
    .from('consumer_qr_scans')
    .select('points_amount')
    .eq('shop_id', shopId)
    .eq('collected_points', true)

  if (!shopError && shopScans && shopScans.length > 0) {
    return {
      balance: shopScans.reduce((sum, scan) => sum + (scan.points_amount || 0), 0),
      source: 'shop_scans',
      scope: 'shop',
    }
  }

  const { data: consumerScans, error: consumerError } = await supabase
    .from('consumer_qr_scans')
    .select('points_amount')
    .eq('consumer_id', shopId)
    .eq('collected_points', true)

  if (!consumerError && consumerScans && consumerScans.length > 0) {
    return {
      balance: consumerScans.reduce((sum, scan) => sum + (scan.points_amount || 0), 0),
      source: 'consumer_scans_fallback',
      scope: 'shop',
    }
  }

  console.warn(`⚠️ No points found for ${shopId}`)
  return { balance: 0, source: 'none', scope: 'shop' }
}

export async function resolveTrustedPointsBalance(
  supabase: SupabaseClient,
  context: PointsBalanceContext
): Promise<ResolvedPointsBalance> {
  let { userId = null, roleCode = null, organizationId = null } = context

  if (userId && (!roleCode || organizationId === undefined)) {
    const { data: userProfile, error: userError } = await supabase
      .from('users')
      .select('role_code, organization_id')
      .eq('id', userId)
      .maybeSingle()

    if (userError) {
      console.warn(`⚠️ Error resolving points balance context for ${userId}:`, userError)
    }

    roleCode = roleCode || userProfile?.role_code || null
    if (organizationId === undefined) {
      organizationId = userProfile?.organization_id || null
    }
  }

  if (userId && (isConsumerScopedRole(roleCode) || !organizationId)) {
    return resolveConsumerPointsBalance(supabase, userId)
  }

  if (organizationId) {
    return resolveShopPointsBalance(supabase, organizationId)
  }

  if (userId) {
    return resolveConsumerPointsBalance(supabase, userId)
  }

  return { balance: 0, source: 'none', scope: 'consumer' }
}

/**
 * Calculate total points balance for a shop or independent consumer
 * 
 * @param supabase - Supabase client instance
 * @param shop_id - The shop organization ID OR user ID for independent consumers
 * @returns Total points collected
 */
export async function calculateShopTotalPoints(
  supabase: SupabaseClient,
  shop_id: string
): Promise<number> {
  const resolved = await resolveShopPointsBalance(supabase, shop_id)
  console.log(`💰 Balance for shop ${shop_id} from ${resolved.source}: ${resolved.balance}`)
  return resolved.balance
}
