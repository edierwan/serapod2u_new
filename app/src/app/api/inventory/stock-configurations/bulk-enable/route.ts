import { NextRequest, NextResponse } from 'next/server'
import { getStockConfigAdminContext } from '@/lib/server/stock-config-admin'
import { isCelleraVapeVariant } from '@/lib/inventory/cellera-variant'

export async function POST(request: NextRequest) {
  const context = await getStockConfigAdminContext()
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status })

  const { variantIds } = await request.json()
  if (!Array.isArray(variantIds) || variantIds.length === 0) {
    return NextResponse.json({ error: 'At least one variant is required' }, { status: 400 })
  }

  // Never trust a client-supplied variant list: re-validate every id against
  // the same Cellera vape-variant predicate the preview endpoint used.
  const { data: variants, error: variantsError } = await context.admin
    .from('product_variants')
    .select('id, is_active, products!inner(id, product_code, product_name, is_vape, is_active)')
    .in('id', variantIds)
  if (variantsError) return NextResponse.json({ error: variantsError.message }, { status: 500 })

  const eligibleIds = (variants || [])
    .filter((variant: any) => {
      if (!variant.is_active) return false
      const product = Array.isArray(variant.products) ? variant.products[0] : variant.products
      return isCelleraVapeVariant(product)
    })
    .map((variant: any) => variant.id)

  if (eligibleIds.length === 0) {
    return NextResponse.json({ error: 'None of the requested variants are eligible Cellera vape variants' }, { status: 400 })
  }

  const { data, error } = await (context.supabase as any).rpc('bulk_enable_variant_stock_configurations', {
    p_variant_ids: eligibleIds,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await context.admin.from('audit_logs').insert({
    user_id: context.user.id,
    user_email: context.user.email || null,
    action: 'BULK_ENABLE_STOCK_CONFIGURATIONS',
    entity_type: 'inventory_stock_configurations',
    entity_id: null,
    new_values: { variant_ids: eligibleIds, result: data },
    user_agent: request.headers.get('user-agent'),
  })

  return NextResponse.json(data)
}
