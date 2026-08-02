import { NextResponse } from 'next/server'
import { getStockConfigAdminContext } from '@/lib/server/stock-config-admin'
import type {
  CarryForwardEligibilityMap,
  CarryForwardLineEligibility,
} from '@/lib/inventory/opening-balance-carry-forward-preflight'

interface ResolverRow {
  order_item_id: string
  variant_id: string
  variant_name: string | null
  alternative_name: string | null
  variant_code: string | null
  product_code: string | null
  order_warehouse_organization_id: string | null
  cutoff_warehouse_organization_id: string | null
  session_warehouse_organization_id: string | null
  stock_config_id: string | null
  config_variant_id: string | null
  config_status: string | null
  allow_so: boolean | null
  default_for_ord: boolean | null
  packaging: string | null
  volume_ml: number | null
  in_session_scope: boolean
  eligible: boolean
  reason_code: string
}

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

/**
 * Read-only D2H Carry Forward preflight.
 *
 * Eligibility is resolved by the database function also used by decision
 * application and atomic posting. This route deliberately contains no local
 * configuration predicate and performs no table writes.
 */
export async function POST(request: Request) {
  const context = await getStockConfigAdminContext()
  if (!context.ok) {
    return NextResponse.json(
      { error: context.error },
      { status: context.status, headers: noStoreHeaders },
    )
  }

  const body = await request.json().catch(() => null)
  const cutoffId = typeof body?.cutoffId === 'string' ? body.cutoffId : null
  const rawOrderItemIds: unknown[] = Array.isArray(body?.orderItemIds)
    ? body.orderItemIds
    : []
  const orderItemIds = Array.from(new Set(
    rawOrderItemIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    ),
  ))

  if (!cutoffId) {
    return NextResponse.json(
      { error: 'An active Opening Balance cutoff is required.' },
      { status: 400, headers: noStoreHeaders },
    )
  }
  if (orderItemIds.length === 0) {
    return NextResponse.json(
      { eligibility: {} as CarryForwardEligibilityMap },
      { headers: noStoreHeaders },
    )
  }

  const { data, error } = await context.admin.rpc(
    'resolve_inventory_cutoff_d2h_carry_forward',
    { p_cutoff_id: cutoffId, p_order_item_ids: orderItemIds },
  )
  if (error) {
    console.error('Carry Forward authoritative preflight failed:', error)
    return NextResponse.json(
      { error: 'Unable to check current Carry Forward configuration readiness.' },
      { status: 500, headers: noStoreHeaders },
    )
  }

  const eligibility: CarryForwardEligibilityMap = {}
  for (const row of (data || []) as ResolverRow[]) {
    const result: CarryForwardLineEligibility = {
      orderItemId: row.order_item_id,
      variantId: row.variant_id,
      carryForwardAvailable: row.eligible,
      configId: row.stock_config_id,
      reasonCode: row.reason_code,
      variantName: row.variant_name,
      alternativeName: row.alternative_name,
      variantCode: row.variant_code,
      productCode: row.product_code,
      orderWarehouseOrganizationId: row.order_warehouse_organization_id,
      cutoffWarehouseOrganizationId: row.cutoff_warehouse_organization_id,
      sessionWarehouseOrganizationId: row.session_warehouse_organization_id,
      configVariantId: row.config_variant_id,
      configStatus: row.config_status,
      allowSo: row.allow_so,
      defaultForOrd: row.default_for_ord,
      packaging: row.packaging,
      volumeMl: row.volume_ml,
      inSessionScope: row.in_session_scope,
    }
    eligibility[row.order_item_id] = result
  }

  return NextResponse.json({ eligibility }, { headers: noStoreHeaders })
}

export const dynamic = 'force-dynamic'
