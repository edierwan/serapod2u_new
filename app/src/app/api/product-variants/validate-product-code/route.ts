import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  PRODUCT_CODE_DUPLICATE_MESSAGE,
  normalizeProductCode,
  validateProductCode,
} from '@/lib/products/product-code'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: { productId?: unknown; productCode?: unknown; variantId?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    if (typeof body.productId !== 'string' || !body.productId) {
      return NextResponse.json({ error: 'Product is required.' }, { status: 400 })
    }
    if (body.variantId != null && typeof body.variantId !== 'string') {
      return NextResponse.json({ error: 'Invalid variant.' }, { status: 400 })
    }

    const validationError = validateProductCode(body.productCode)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const productCode = normalizeProductCode(body.productCode)
    if (!productCode) {
      return NextResponse.json({ valid: true, productCode: null })
    }

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('brand_id')
      .eq('id', body.productId)
      .single()

    if (productError || !product) {
      return NextResponse.json({ error: 'Product could not be found.' }, { status: 404 })
    }

    // Legacy products without a Brand have no Brand scope to compare. The database
    // applies the same rule and will start enforcing uniqueness once a Brand is set.
    if (!product.brand_id) {
      return NextResponse.json({ valid: true, productCode })
    }

    let duplicateQuery = (supabase as any)
      .from('product_variants')
      .select('id, products!inner(brand_id)')
      .eq('product_code', productCode)
      .eq('products.brand_id', product.brand_id)

    if (body.variantId) {
      duplicateQuery = duplicateQuery.neq('id', body.variantId)
    }

    const { data: duplicate, error: duplicateError } = await duplicateQuery.limit(1).maybeSingle()

    if (duplicateError) throw duplicateError
    if (duplicate) {
      return NextResponse.json({ error: PRODUCT_CODE_DUPLICATE_MESSAGE }, { status: 409 })
    }

    return NextResponse.json({ valid: true, productCode })
  } catch (error) {
    console.error('Error validating Product Code:', error)
    return NextResponse.json({ error: 'Failed to validate Product Code.' }, { status: 500 })
  }
}
