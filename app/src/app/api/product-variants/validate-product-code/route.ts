import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  PRODUCT_CODE_DUPLICATE_MESSAGE,
  PRODUCT_CODE_VALIDATION_UNAVAILABLE_MESSAGE,
  normalizeProductCode,
  validateProductCode,
} from '@/lib/products/product-code'
import {
  ALTERNATIVE_NAME_DUPLICATE_MESSAGE,
  cleanAlternativeName,
  normalizeAlternativeName,
} from '@/lib/products/alternative-name'

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

    let body: { productId?: unknown; productCode?: unknown; alternativeName?: unknown; variantId?: unknown }
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
    const alternativeName = cleanAlternativeName(body.alternativeName)

    if (alternativeName) {
      let alternativeQuery = (supabase as any)
        .from('product_variants')
        .select('id, alternative_name')
        .eq('product_id', body.productId)
        .eq('is_active', true)
        .not('alternative_name', 'is', null)

      if (body.variantId) {
        alternativeQuery = alternativeQuery.neq('id', body.variantId)
      }

      const { data: alternatives, error: alternativeError } = await alternativeQuery
      if (alternativeError) throw alternativeError

      const normalizedAlternativeName = normalizeAlternativeName(alternativeName)
      const duplicate = (alternatives || []).some((candidate: { alternative_name?: string | null }) =>
        normalizeAlternativeName(candidate.alternative_name) === normalizedAlternativeName,
      )
      if (duplicate) {
        return NextResponse.json(
          { error: ALTERNATIVE_NAME_DUPLICATE_MESSAGE, field: 'alternative_name' },
          { status: 409 },
        )
      }
    }

    if (productCode) {
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
      if (product.brand_id) {
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
          return NextResponse.json({ error: PRODUCT_CODE_DUPLICATE_MESSAGE, field: 'product_code' }, { status: 409 })
        }
      }
    }

    return NextResponse.json({
      valid: true,
      productCode,
      ...(alternativeName ? { alternativeName } : {}),
    })
  } catch (error) {
    console.error('Error validating Product Code:', error)
    return NextResponse.json(
      { error: PRODUCT_CODE_VALIDATION_UNAVAILABLE_MESSAGE },
      { status: 500 },
    )
  }
}
