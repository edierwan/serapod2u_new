/**
 * H2M warehouse receipt — inventory destination (stock configuration).
 *
 * TypeScript mirror of the resolution inside public.post_warehouse_receipt()
 * (migration 20260915130000_warehouse_receipt_config_resolution.sql). The
 * database remains the authority; this mirror lets the Receive screen show the
 * destination before posting and lets the rule be unit tested.
 *
 * Hierarchy, per order line (order + variant), first match wins:
 *
 *   1. order_item    The explicit order_items.stock_config_id. Unchanged rule:
 *                    several distinct explicit configurations for the same
 *                    variant are a conflict and block.
 *   2. previous      Continuity: the one configuration earlier posted receipts
 *      receipt       of this order + variant landed in (receipt line, else its
 *                    stock movement). Configurations retired by
 *                    LEGACY-CONFIG-CUTOVER-2026 (50NB / 50OB / UNCLASSIFIED)
 *                    are not a continuity signal — that programme is the
 *                    supported transition onto the canonical configuration.
 *                    More than one distinct configuration blocks.
 *   3. canonical     The canonical operational configuration
 *                    (resolveCanonicalStockConfig ↔ resolve_operational_stock_config):
 *                    exactly one active default_for_ord, non-UNCLASSIFIED,
 *                    non-repack configuration. None or several blocks.
 *
 * Whatever the source, the result must still belong to the variant and be
 * active with allow_ord — the receipt rule that existed before — or it blocks.
 * Nothing is ever posted to a guessed bucket.
 */
import {
  LEGACY_CONFIG_CODES,
  resolveCanonicalStockConfig,
  type StockConfigurationLike,
} from '@/lib/inventory/canonical-stock-config'

export const RECEIPT_CONFIG_ERROR = 'warehouse_receipt_order_item_configuration_missing_or_conflicting'

export type ReceiptConfigSource = 'order_item' | 'previous_receipt' | 'canonical'

export interface ReceiptStockConfiguration extends StockConfigurationLike {
  variant_id: string
  allow_ord?: boolean | null
  stock_sku?: string | null
}

export interface ReceiptConfigInput {
  variantId: string
  /** stock_config_id of every order_items row for this order + variant (nulls included). */
  orderItemConfigIds: Array<string | null | undefined>
  /** Configuration of each earlier posted receipt line (received_now > 0) for this order + variant. */
  previousReceiptConfigIds: Array<string | null | undefined>
  /** Configurations to look ids up in — at least the variant's own. */
  configs: ReceiptStockConfiguration[]
}

export type ReceiptConfigResolution =
  | { ok: true; stockConfigId: string; source: ReceiptConfigSource; config: ReceiptStockConfiguration }
  | { ok: false; source: ReceiptConfigSource; error: string }

const distinct = (ids: Array<string | null | undefined>) =>
  Array.from(new Set(ids.filter((id): id is string => !!id)))

const isLegacyCutoverCode = (code?: string | null) =>
  (LEGACY_CONFIG_CODES as readonly string[]).includes((code || '').trim().toUpperCase())

export function resolveReceiptStockConfig(input: ReceiptConfigInput): ReceiptConfigResolution {
  const { variantId, configs } = input
  const byId = new Map(configs.map((c) => [c.id, c]))
  const fail = (source: ReceiptConfigSource, detail: string): ReceiptConfigResolution => ({
    ok: false,
    source,
    error: `${RECEIPT_CONFIG_ERROR}: variant ${variantId} (${detail})`,
  })

  let source: ReceiptConfigSource = 'order_item'
  let configId: string | null = null

  if (input.orderItemConfigIds.length === 0) return fail(source, 'variant is not on the order')
  const explicit = distinct(input.orderItemConfigIds)
  if (explicit.length > 1) return fail(source, 'order items carry conflicting configurations')
  configId = explicit[0] ?? null

  if (!configId) {
    source = 'previous_receipt'
    const previous = distinct(input.previousReceiptConfigIds).filter((id) => byId.has(id) && !isLegacyCutoverCode(byId.get(id)?.config_code))
    if (previous.length > 1) return fail(source, 'previous receipts landed in more than one configuration')
    configId = previous[0] ?? null
  }

  if (!configId) {
    source = 'canonical'
    const canonical = resolveCanonicalStockConfig(configs.filter((c) => c.variant_id === variantId))
    if (!canonical.ok) return fail(source, canonical.reason === 'ambiguous' ? 'ambiguous canonical configuration' : 'no canonical configuration')
    configId = canonical.stockConfigId
  }

  const config = byId.get(configId)
  if (!config || config.variant_id !== variantId || (config.status || '').toLowerCase() !== 'active' || !config.allow_ord) {
    return fail(source, 'configuration is not an active ORD configuration of this variant')
  }
  return { ok: true, stockConfigId: configId, source, config }
}
