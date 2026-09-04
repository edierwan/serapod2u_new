import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSerappAccessDecision } from '@/lib/serapp/access'
import { SERAPP_ORDER_SOURCE_MARKER } from '@/lib/serapp/constants'
import {
  DEFAULT_FULFILLMENT_WAREHOUSE_COLUMN,
  loadActiveHqFulfillmentWarehouses,
  resolveDefaultFulfillmentWarehouseId,
  resolveSellerHqId,
} from '@/lib/orders/hq-fulfillment-warehouses'
import { resolveQuickOrderCatalog, type QuickOrderCatalogVariant } from '@/lib/orders/quick-order-catalog'

export { SERAPP_ORDER_SOURCE_MARKER } from '@/lib/serapp/constants'

export interface SerappDistributorContext {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  distributorId: string
  distributorName: string
  hqId: string
  fulfillmentWarehouseId: string
  isHqSupport: boolean
  requesterOrganizationId: string
}

export async function resolveSerappDistributorContext(options?: {
  distributorId?: string | null
  fulfillmentWarehouseId?: string | null
}): Promise<SerappDistributorContext> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    throw Object.assign(new Error('Unauthorized'), { status: 401 })
  }

  const { data: requester, error: requesterError } = await supabase
    .from('users')
    .select(`
      id,
      organization_id,
      account_scope,
      organizations:organization_id (
        id,
        org_name,
        org_type_code,
        org_code,
        parent_org_id,
        ${DEFAULT_FULFILLMENT_WAREHOUSE_COLUMN}
      )
    `)
    .eq('id', user.id)
    .single()

  if (requesterError || !requester?.organization_id) {
    throw Object.assign(new Error('User organization not found.'), { status: 403 })
  }

  const organization = Array.isArray(requester.organizations)
    ? requester.organizations[0]
    : requester.organizations

  if (!organization) {
    throw Object.assign(new Error('Organization not found.'), { status: 403 })
  }

  const access = getSerappAccessDecision({
    accountScope: requester.account_scope,
    orgTypeCode: organization.org_type_code,
    organizationId: requester.organization_id,
    roleLevel: null,
  })
  if (!access.allowed) {
    throw Object.assign(new Error(access.reason), { status: 403 })
  }

  let distributorId = requester.organization_id
  if (access.isHqSupport) {
    if (!options?.distributorId) {
      throw Object.assign(
        new Error('HQ support must select a distributor before using Serapp order actions.'),
        { status: 400 },
      )
    }
    distributorId = options.distributorId
  }

  const { data: distributor, error: distributorError } = await supabase
    .from('organizations')
    .select('id, org_name, org_type_code, parent_org_id, is_active')
    .eq('id', distributorId)
    .single()

  if (distributorError || !distributor || distributor.org_type_code !== 'DIST' || !distributor.is_active) {
    throw Object.assign(new Error('Active distributor organization is required.'), { status: 400 })
  }

  const hqId = resolveSellerHqId({
    id: distributor.id,
    org_type_code: distributor.org_type_code,
    parent_org_id: distributor.parent_org_id,
  }) || distributor.parent_org_id

  if (!hqId) {
    throw Object.assign(new Error('Distributor is not linked to an HQ.'), { status: 400 })
  }

  const { data: hqOrg, error: hqError } = await supabase
    .from('organizations')
    .select(`id, org_type_code, parent_org_id, ${DEFAULT_FULFILLMENT_WAREHOUSE_COLUMN}`)
    .eq('id', hqId)
    .single()

  if (hqError || !hqOrg) {
    throw Object.assign(new Error('Unable to resolve HQ for fulfillment warehouse.'), { status: 500 })
  }

  const { data: warehouses, error: warehouseError } = await loadActiveHqFulfillmentWarehouses(supabase, hqId)
  if (warehouseError) {
    throw Object.assign(new Error(warehouseError.message), { status: 500 })
  }

  const defaultResolved = resolveDefaultFulfillmentWarehouseId(
    (hqOrg as any)[DEFAULT_FULFILLMENT_WAREHOUSE_COLUMN],
    warehouses,
  )

  const fulfillmentWarehouseId = options?.fulfillmentWarehouseId
    || defaultResolved.warehouseId
    || warehouses[0]?.id
    || null

  if (!fulfillmentWarehouseId) {
    throw Object.assign(
      new Error('No fulfillment warehouse is configured for this distributor HQ.'),
      { status: 400 },
    )
  }

  return {
    supabase,
    userId: user.id,
    distributorId: distributor.id,
    distributorName: distributor.org_name,
    hqId,
    fulfillmentWarehouseId,
    isHqSupport: access.isHqSupport,
    requesterOrganizationId: requester.organization_id,
  }
}

/**
 * Load Quick Order catalog + warehouse availability for Serapp.
 *
 * Uses the admin client for inventory reads: distributor portal sessions are
 * blocked by product_inventory RLS from seeing HQ warehouse balances, which
 * incorrectly made every Check result look Out of Stock. Authorization already
 * happened in resolveSerappDistributorContext before this runs.
 */
export async function loadSerappCatalog(ctx: SerappDistributorContext) {
  const admin = createAdminClient()
  return resolveQuickOrderCatalog(
    admin,
    ctx.distributorId,
    ctx.hqId,
    ctx.fulfillmentWarehouseId,
  )
}

export function buildSerappOrderNotes(input: {
  pasteText: string
  distributorName: string
  warehouseName?: string | null
  /**
   * Optional messaging channel label (e.g. Telegram).
   * Keeps the existing Serapp source marker so warehouse hold / history filters still match.
   */
  channelLabel?: string | null
}) {
  const pastePreview = input.pasteText.trim().slice(0, 1800)
  const channel = input.channelLabel?.trim()
  return [
    SERAPP_ORDER_SOURCE_MARKER,
    channel ? `Channel: ${channel}` : null,
    `Distributor: ${input.distributorName}`,
    input.warehouseName ? `Fulfillment Warehouse: ${input.warehouseName}` : null,
    'Original paste:',
    pastePreview,
  ].filter(Boolean).join('\n')
}

export interface SerappConfirmLine {
  product_id: string
  variant_id: string
  qty: number
  unit_price: number
  raw?: string
}

/**
 * Build confirmable lines from a fresh paste-check result set.
 * - Fully available matched lines are included at requested qty.
 * - Insufficient-stock lines are included only when acceptAvailableOnly is true,
 *   capped to available_qty from the catalog.
 * - Review / OOS / unmatched lines are excluded.
 */
export function buildSerappConfirmItems(
  results: Array<{
    status: string
    selectedVariantId?: string
    quantity: number | null
    inventoryOutcome?: string
    raw?: string
  }>,
  variants: QuickOrderCatalogVariant[],
  options?: { acceptAvailableOnly?: boolean },
): { items: SerappConfirmLine[]; skipped: number } {
  const acceptAvailableOnly = options?.acceptAvailableOnly !== false
  const byId = new Map(variants.map(variant => [variant.id, variant]))
  const items: SerappConfirmLine[] = []
  let skipped = 0

  for (const result of results) {
    if (result.status === 'section_header') continue
    if (result.status !== 'matched' && result.status !== 'alternative_match') {
      skipped += 1
      continue
    }
    if (!result.selectedVariantId || !result.quantity || result.quantity <= 0) {
      skipped += 1
      continue
    }

    const variant = byId.get(result.selectedVariantId)
    if (!variant || variant.distributor_price <= 0) {
      skipped += 1
      continue
    }

    if (result.inventoryOutcome === 'matched') {
      items.push({
        product_id: variant.product_id,
        variant_id: variant.id,
        qty: result.quantity,
        unit_price: variant.distributor_price,
        raw: result.raw,
      })
      continue
    }

    if (
      acceptAvailableOnly
      && result.inventoryOutcome === 'insufficient_stock'
      && variant.available_qty > 0
    ) {
      items.push({
        product_id: variant.product_id,
        variant_id: variant.id,
        qty: Math.min(result.quantity, variant.available_qty),
        unit_price: variant.distributor_price,
        raw: result.raw,
      })
      continue
    }

    skipped += 1
  }

  // Combine duplicate variants (same flavour across accidental duplicates).
  const combined = new Map<string, SerappConfirmLine>()
  for (const item of items) {
    const existing = combined.get(item.variant_id)
    if (existing) {
      existing.qty += item.qty
    } else {
      combined.set(item.variant_id, { ...item })
    }
  }

  return { items: Array.from(combined.values()), skipped }
}
