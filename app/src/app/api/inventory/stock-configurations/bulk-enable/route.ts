import { NextRequest, NextResponse } from 'next/server'
import { getStockConfigAdminContext } from '@/lib/server/stock-config-admin'
import {
  CONCENTRATION_INELIGIBLE_MESSAGES,
  evaluateConcentrationStockConfigEligibility,
  readVariantRelations,
} from '@/lib/inventory/concentration-stock-eligibility'

const ENABLE_VARIANT_SELECT =
  'id, variant_name, is_active, ' +
  'products!inner(id, product_code, product_name, is_vape, is_active, product_groups(id, group_name, stock_config_profile))'

export async function POST(request: NextRequest) {
  const context = await getStockConfigAdminContext()
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status })

  const { variantIds } = await request.json()
  if (!Array.isArray(variantIds) || variantIds.length === 0) {
    return NextResponse.json({ error: 'At least one variant is required' }, { status: 400 })
  }

  // Normalize and dedupe before anything else, so a repeated id cannot be
  // counted twice and a malformed entry cannot reach the query.
  const requestedIds = Array.from(
    new Set(variantIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0).map((id: string) => id.trim())),
  )
  if (requestedIds.length === 0) {
    return NextResponse.json({ error: 'At least one valid variant id is required' }, { status: 400 })
  }

  // Never trust a client-supplied variant list. Every requested id is re-fetched
  // with its product and product group, and re-tested against the same
  // concentration rule the preview endpoint used. A Device variant id posted
  // directly to this endpoint is rejected here, before the RPC.
  const { data: variants, error: variantsError } = await context.admin
    .from('product_variants')
    .select(ENABLE_VARIANT_SELECT)
    .in('id', requestedIds)
  if (variantsError) return NextResponse.json({ error: variantsError.message }, { status: 500 })

  const rowsById = new Map((variants || []).map((variant: any) => [variant.id, variant]))

  // Fail closed and atomically: a mixed payload is rejected in full rather than
  // partially enabling its eligible subset, so the operator is never left
  // guessing which variants were actually changed.
  const rejected = requestedIds.flatMap((variantId) => {
    const variant = rowsById.get(variantId)
    if (!variant) {
      return [{ variantId, reason: 'variant_not_found' as const, message: CONCENTRATION_INELIGIBLE_MESSAGES.variant_not_found }]
    }
    const { product, groupName, groupStockConfigProfile } = readVariantRelations(variant)
    const result = evaluateConcentrationStockConfigEligibility({
      variantIsActive: variant.is_active,
      product,
      groupStockConfigProfile,
    })
    if (result.eligible || !result.reason) return []
    return [{
      variantId,
      variantName: variant.variant_name ?? null,
      productName: product?.product_name ?? null,
      groupName,
      groupStockConfigProfile,
      reason: result.reason,
      message: CONCENTRATION_INELIGIBLE_MESSAGES[result.reason],
    }]
  })

  if (rejected.length > 0) {
    return NextResponse.json({
      error: `${rejected.length} of ${requestedIds.length} requested variant(s) are not eligible for concentration stock configurations (20NB/50NB/50OB). No configuration was changed.`,
      rejected,
    }, { status: 400 })
  }

  const { data, error } = await (context.supabase as any).rpc('bulk_enable_variant_stock_configurations', {
    p_variant_ids: requestedIds,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await context.admin.from('audit_logs').insert({
    user_id: context.user.id,
    user_email: context.user.email || null,
    action: 'BULK_ENABLE_STOCK_CONFIGURATIONS',
    entity_type: 'inventory_stock_configurations',
    entity_id: null,
    new_values: { variant_ids: requestedIds, result: data },
    user_agent: request.headers.get('user-agent'),
  })

  return NextResponse.json(data)
}
