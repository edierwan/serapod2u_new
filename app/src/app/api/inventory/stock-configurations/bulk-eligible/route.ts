import { NextResponse } from 'next/server'
import { getStockConfigAdminContext } from '@/lib/server/stock-config-admin'
import {
  isConcentrationStockConfigEligible,
  readVariantRelations,
} from '@/lib/inventory/concentration-stock-eligibility'

// The variant → product → group chain is what decides concentration
// eligibility, so the group profile must be selected here rather than inferred
// from the product name or code.
const ELIGIBLE_VARIANT_SELECT =
  'id, variant_name, product_code, is_active, ' +
  'products!inner(id, product_code, product_name, is_vape, is_active, product_groups(id, group_name, stock_config_profile))'

export async function GET() {
  const context = await getStockConfigAdminContext()
  if (!context.ok) return NextResponse.json({ error: context.error }, { status: context.status })

  const { data: variants, error } = await context.admin
    .from('product_variants')
    .select(ELIGIBLE_VARIANT_SELECT)
    .eq('is_active', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const eligible = (variants || []).filter((variant: any) => {
    const { product, groupStockConfigProfile } = readVariantRelations(variant)
    return isConcentrationStockConfigEligible({
      variantIsActive: variant.is_active,
      product,
      groupStockConfigProfile,
    })
  })
  const variantIds = eligible.map((variant: any) => variant.id)

  const { data: enabledConfigs, error: configError } = variantIds.length
    ? await context.admin.from('inventory_stock_configurations').select('variant_id').in('variant_id', variantIds).eq('config_code', '20NB')
    : { data: [], error: null }
  if (configError) return NextResponse.json({ error: configError.message }, { status: 500 })
  const enabledVariantIds = new Set((enabledConfigs || []).map((row: any) => row.variant_id))

  return NextResponse.json({
    variants: eligible.map((variant: any) => {
      const { product, groupName, groupStockConfigProfile } = readVariantRelations(variant)
      return {
        id: variant.id,
        variantName: variant.variant_name,
        // The variant-level Product Code from Products > Master Data >
        // Variants. Deliberately NOT variant_code and NOT the parent
        // products.product_code — null stays null so the UI shows no suffix.
        variantProductCode: variant.product_code || null,
        productName: product?.product_name || '',
        groupName,
        groupStockConfigProfile,
        alreadyEnabled: enabledVariantIds.has(variant.id),
      }
    }),
  })
}
