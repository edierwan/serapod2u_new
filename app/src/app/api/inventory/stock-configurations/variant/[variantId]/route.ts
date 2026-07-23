import { NextRequest, NextResponse } from 'next/server'
import { getStockConfigAdminContext } from '@/lib/server/stock-config-admin'
import { isCelleraVapeVariant } from '@/lib/inventory/cellera-variant'

async function loadVariantConfiguration(admin: any, variantId: string) {
  const { data: variant, error: variantError } = await admin
    .from('product_variants')
    .select('id, variant_code, variant_name, is_active, products(id, product_code, product_name, is_vape, is_active)')
    .eq('id', variantId)
    .single()
  if (variantError || !variant) return { error: 'Variant not found', status: 404 }

  const product = Array.isArray(variant.products) ? variant.products[0] : variant.products
  if (!isCelleraVapeVariant(product)) return { error: 'Stock configuration administration is limited to Cellera vape variants', status: 400 }

  const [{ data: configurations, error: configError }, { data: balances, error: balanceError }, eligibilityResult] = await Promise.all([
    admin.from('inventory_stock_configurations')
      .select('id, variant_id, config_code, config_label, stock_sku, volume_ml, packaging, status, is_variant_default, allow_ord, allow_so, default_for_ord, requires_repacking_before_sale, sort_order')
      .eq('variant_id', variantId)
      .order('sort_order'),
    admin.from('product_inventory')
      .select('stock_config_id, quantity_on_hand, quantity_allocated, quantity_available')
      .eq('variant_id', variantId)
      .eq('is_active', true),
    admin.from('distributor_stock_config_eligibility')
      .select('distributor_org_id', { count: 'exact', head: true })
      .eq('allow_50ml_new_box', true),
  ])
  if (configError || balanceError) return { error: configError?.message || balanceError?.message, status: 500 }

  const totals = new Map<string, { onHand: number; allocated: number; available: number }>()
  for (const balance of balances || []) {
    const key = String(balance.stock_config_id)
    const current = totals.get(key) || { onHand: 0, allocated: 0, available: 0 }
    current.onHand += Number(balance.quantity_on_hand || 0)
    current.allocated += Number(balance.quantity_allocated || 0)
    current.available += Number(balance.quantity_available || 0)
    totals.set(key, current)
  }

  const rows = (configurations || []).map((config: any) => ({
    ...config,
    ...(totals.get(config.id) || { onHand: 0, allocated: 0, available: 0 }),
    eligibleDistributorCount: config.config_code === '50NB' ? Number(eligibilityResult.count || 0) : null,
  }))
  return {
    data: {
      variant: { id: variant.id, variantCode: variant.variant_code, variantName: variant.variant_name },
      enabled: rows.some((config: any) => config.volume_ml !== null),
      configurations: rows.filter((config: any) => config.volume_ml !== null),
      legacy: rows.filter((config: any) => config.volume_ml === null && config.packaging === null),
    },
    status: 200,
  }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ variantId: string }> }) {
  const context = await getStockConfigAdminContext()
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status })
  const { variantId } = await params
  const result = await loadVariantConfiguration(context.admin, variantId)
  return NextResponse.json(result.data || { error: result.error }, { status: result.status })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ variantId: string }> }) {
  const context = await getStockConfigAdminContext()
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status })
  const { variantId } = await params
  const before = await loadVariantConfiguration(context.admin, variantId)
  if (!before.data) return NextResponse.json({ error: before.error }, { status: before.status })

  const body = await request.json().catch(() => ({}))
  const profile = body?.profile === 'new_standard' ? 'new_standard' : null

  const { data, error } = profile
    ? await (context.supabase as any).rpc('enable_variant_stock_configurations_with_profile', {
        p_variant_id: variantId, p_profile: profile,
      })
    : await (context.supabase as any).rpc('enable_variant_stock_configurations', {
        p_variant_id: variantId,
      })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  const after = await loadVariantConfiguration(context.admin, variantId)
  return NextResponse.json({ result: data, ...after.data }, { status: after.status })
}

