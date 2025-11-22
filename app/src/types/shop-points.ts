/**
 * TypeScript interfaces for Shop Points Ledger and Balance views
 * Generated from migration 035_enhance_shop_points_ledger.sql
 */

/**
 * Row from shop_points_ledger view
 * Complete ledger of all shop point movements including QR scans, manual adjustments, and redemptions
 */
export interface ShopPointsLedgerRow {
  id: string
  shop_id: string | null
  consumer_id: string | null
  journey_config_id: string | null
  order_id: string | null
  order_item_id: string | null
  product_id: string | null
  variant_id: string | null
  occurred_at: string
  points_change: number
  transaction_type: 'scan' | 'manual' | 'adjust' | 'redeem' | string
  is_manual_adjustment: boolean
  adjusted_by: string | null
  adjustment_reason: string | null
  redeem_item_id: string | null
  consumer_phone: string | null
  consumer_email: string | null
  description: string | null
  // Denormalized fields from joins (populated directly in view)
  variant_name: string | null
  product_name: string | null
  reward_name: string | null
  reward_code: string | null
  order_no: string | null
}

/**
 * Row from v_shop_points_balance view
 * Aggregated shop point balances with breakdown by transaction type
 */
export interface ShopPointsBalanceRow {
  shop_id: string
  /** Current point balance (earned - redeemed + adjustments) */
  current_balance: number
  /** Total number of all transactions */
  transaction_count: number
  /** Date of first transaction */
  first_transaction_at: string
  /** Date of most recent transaction */
  last_transaction_at: string
  /** Total points earned from QR scans */
  total_earned_scans: number
  /** Total points from manual adjustments (can be positive or negative) */
  total_manual_adjustments: number
  /** Total points redeemed (absolute value) */
  total_redeemed: number
  /** Number of QR scan transactions */
  scan_count: number
  /** Number of redemption transactions */
  redemption_count: number
}

/**
 * Extended ledger row with additional shop organization details
 */
export interface ShopPointsLedgerExtended extends ShopPointsLedgerRow {
  // Shop organization info (for admin views)
  shop_name?: string | null
  shop_phone?: string | null
  shop_email?: string | null
}

/**
 * Extended balance row with shop organization details
 */
export interface ShopPointsBalanceExtended extends ShopPointsBalanceRow {
  shop_name: string
  shop_phone: string | null
  shop_email: string | null
  shop_status: string
  shop_created_at: string
}

/**
 * Transaction type filters for ledger queries
 */
export type TransactionTypeFilter = 'all' | 'scan' | 'manual' | 'adjust' | 'redeem'

/**
 * Query parameters for fetching ledger transactions
 */
export interface ShopPointsLedgerQuery {
  shop_id: string
  transaction_type?: TransactionTypeFilter
  start_date?: string
  end_date?: string
  order_no?: string
  limit?: number
  offset?: number
}
