import { NextResponse } from 'next/server'
import { getStockConfigAdminContext } from '@/lib/server/stock-config-admin'
import { isCelleraVapeVariant } from '@/lib/inventory/cellera-variant'

export async function GET() {
  const context = await getStockConfigAdminContext()
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status })

  const { data: variants, error } = await context.admin
    .from('product_variants')
    .select('id, variant_name, variant_code, is_active, products!inner(id, product_code, product_name, is_vape, is_active)')
    .eq('is_active', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const eligible = (variants || []).filter((variant: any) => {
    const product = Array.isArray(variant.products) ? variant.products[0] : variant.products
    return isCelleraVapeVariant(product)
  })
  const variantIds = eligible.map((variant: any) => variant.id)

  const { data: enabledConfigs, error: configError } = variantIds.length
    ? await context.admin.from('inventory_stock_configurations').select('variant_id').in('variant_id', variantIds).eq('config_code', '20NB')
    : { data: [], error: null }
  if (configError) return NextResponse.json({ error: configError.message }, { status: 500 })
  const enabledVariantIds = new Set((enabledConfigs || []).map((row: any) => row.variant_id))

  return NextResponse.json({
    variants: eligible.map((variant: any) => {
      const product = Array.isArray(variant.products) ? variant.products[0] : variant.products
      return {
        id: variant.id,
        variantName: variant.variant_name,
        variantCode: variant.variant_code,
        productName: product?.product_name || '',
        productCode: product?.product_code || '',
        alreadyEnabled: enabledVariantIds.has(variant.id),
      }
    }),
  })
}
