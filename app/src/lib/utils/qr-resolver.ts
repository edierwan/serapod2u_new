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
  points_amount: number | null
  points_collected_at: string | null
  shop_id: string | null
} | null> {
  const { data: collectionRecord, error } = await supabase
    .from('consumer_qr_scans')
    .select('id, points_amount, points_collected_at, shop_id')
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
  // Try to get balance from the view first (includes redemptions and adjustments)
  const { data: balance, error: viewError } = await supabase
    .from('v_shop_points_balance')
    .select('current_balance')
    .eq('shop_id', shop_id)
    .maybeSingle()

  if (!viewError && balance) {
    console.log(`💰 Balance for shop ${shop_id} from view: ${balance.current_balance}`)
    return balance.current_balance
  }

  if (viewError) {
    console.warn('⚠️ Error fetching balance from view, falling back to scan sum:', viewError)
  }

  // Fallback 1: Try by shop_id (organization)
  const { data: shopScans, error: shopError } = await supabase
    .from('consumer_qr_scans')
    .select('points_amount')
    .eq('shop_id', shop_id)
    .eq('collected_points', true)
  
  if (!shopError && shopScans && shopScans.length > 0) {
    const total = shopScans.reduce((sum, scan) => sum + (scan.points_amount || 0), 0)
    console.log(`💰 Total points for shop ${shop_id}: ${total}`)
    return total
  }

  // Fallback 2: Try by consumer_id (for independent consumers who have no organization)
  const { data: consumerScans, error: consumerError } = await supabase
    .from('consumer_qr_scans')
    .select('points_amount')
    .eq('consumer_id', shop_id)
    .eq('collected_points', true)
  
  if (!consumerError && consumerScans && consumerScans.length > 0) {
    const total = consumerScans.reduce((sum, scan) => sum + (scan.points_amount || 0), 0)
    console.log(`💰 Total points for consumer ${shop_id}: ${total}`)
    return total
  }

  console.warn(`⚠️ No points found for ${shop_id}`)
  return 0
}
