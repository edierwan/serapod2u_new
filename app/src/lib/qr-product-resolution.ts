import { parseQRCode } from '@/lib/qr-code-utils'

type ProductRecord = {
    id: string
    product_code?: string | null
    product_name?: string | null
    brands?: { brand_name?: string | null } | Array<{ brand_name?: string | null }> | null
    product_images?: Array<{ image_url?: string | null; is_primary?: boolean | null }> | null
}

type VariantRecord = {
    id: string
    variant_name?: string | null
    variant_code?: string | null
    image_url?: string | null
    products?: ProductRecord | ProductRecord[] | null
}

type SupabaseLikeClient = {
    from: (table: string) => any
}

interface ResolveQrProductInput {
    code?: string | null
    product_id?: string | null
    variant_id?: string | null
    order_item_id?: string | null
}

function pickSingleRelation<T>(value: T | T[] | null | undefined): T | null {
    if (!value) {
        return null
    }

    return Array.isArray(value) ? (value[0] ?? null) : value
}

function normalizeVariantRecord(variant: VariantRecord | null): VariantRecord | null {
    if (!variant) {
        return null
    }

    return {
        ...variant,
        products: pickSingleRelation(variant.products as ProductRecord | ProductRecord[] | null | undefined),
    }
}

async function fetchProductById(supabase: SupabaseLikeClient, productId: string): Promise<ProductRecord | null> {
    const { data } = await supabase
        .from('products')
        .select(`
      id,
      product_code,
      product_name,
      brands(brand_name),
      product_images(image_url, is_primary)
    `)
        .eq('id', productId)
        .maybeSingle()

    return (data as ProductRecord | null) ?? null
}

async function fetchProductByCode(supabase: SupabaseLikeClient, productCode: string): Promise<ProductRecord | null> {
    const { data } = await supabase
        .from('products')
        .select(`
      id,
      product_code,
      product_name,
      brands(brand_name),
      product_images(image_url, is_primary)
    `)
        .eq('product_code', productCode)
        .maybeSingle()

    return (data as ProductRecord | null) ?? null
}

async function fetchVariantById(supabase: SupabaseLikeClient, variantId: string): Promise<VariantRecord | null> {
    const { data } = await supabase
        .from('product_variants')
        .select(`
      id,
      variant_name,
      variant_code,
      image_url,
      products(
        id,
        product_code,
        product_name,
        brands(brand_name),
        product_images(image_url, is_primary)
      )
    `)
        .eq('id', variantId)
        .maybeSingle()

    return normalizeVariantRecord((data as VariantRecord | null) ?? null)
}

async function fetchVariantByProductAndCode(
    supabase: SupabaseLikeClient,
    productId: string,
    variantCode: string
): Promise<VariantRecord | null> {
    const selectClause = `
    id,
    variant_name,
    variant_code,
    image_url,
    products(
      id,
      product_code,
      product_name,
      brands(brand_name),
      product_images(image_url, is_primary)
    )
  `

    const { data: directMatch } = await supabase
        .from('product_variants')
        .select(selectClause)
        .eq('product_id', productId)
        .eq('variant_code', variantCode)
        .maybeSingle()

    const normalizedDirectMatch = normalizeVariantRecord((directMatch as VariantRecord | null) ?? null)
    if (normalizedDirectMatch) {
        return normalizedDirectMatch
    }

    const variantParts = variantCode.split(/-(.+)/)
    const baseVariantCode = variantParts[0]
    const manufacturerSku = variantParts[1]

    if (!baseVariantCode || !manufacturerSku) {
        return null
    }

    const { data: splitMatch } = await supabase
        .from('product_variants')
        .select(selectClause)
        .eq('product_id', productId)
        .eq('variant_code', baseVariantCode)
        .eq('manufacturer_sku', manufacturerSku)
        .maybeSingle()

    return normalizeVariantRecord((splitMatch as VariantRecord | null) ?? null)
}

async function fetchOrderItemRefs(
    supabase: SupabaseLikeClient,
    orderItemId: string
): Promise<{ product_id?: string | null; variant_id?: string | null } | null> {
    const { data } = await supabase
        .from('order_items')
        .select('product_id, variant_id')
        .eq('id', orderItemId)
        .maybeSingle()

    return (data as { product_id?: string | null; variant_id?: string | null } | null) ?? null
}

export async function resolveQrProductContext(
    supabase: SupabaseLikeClient,
    qrCode: ResolveQrProductInput
): Promise<{ product: ProductRecord | null; variant: VariantRecord | null }> {
    let product: ProductRecord | null = null
    let variant: VariantRecord | null = null

    if (qrCode.variant_id) {
        variant = await fetchVariantById(supabase, qrCode.variant_id)
        product = pickSingleRelation(variant?.products as ProductRecord | ProductRecord[] | null | undefined)
    }

    if (!product && qrCode.product_id) {
        product = await fetchProductById(supabase, qrCode.product_id)
    }

    if ((!product || !variant) && qrCode.order_item_id) {
        const orderItemRefs = await fetchOrderItemRefs(supabase, qrCode.order_item_id)

        if (!variant && orderItemRefs?.variant_id) {
            variant = await fetchVariantById(supabase, orderItemRefs.variant_id)
            product = product ?? pickSingleRelation(variant?.products as ProductRecord | ProductRecord[] | null | undefined)
        }

        if (!product && orderItemRefs?.product_id) {
            product = await fetchProductById(supabase, orderItemRefs.product_id)
        }
    }

    if ((!product || !variant) && qrCode.code) {
        const parsedCode = parseQRCode(qrCode.code)

        if (parsedCode.isValid && parsedCode.type === 'PRODUCT' && parsedCode.productCode) {
            product = product ?? (await fetchProductByCode(supabase, parsedCode.productCode))

            if (!variant && product?.id && parsedCode.variantCode) {
                variant = await fetchVariantByProductAndCode(supabase, product.id, parsedCode.variantCode)
            }

            product = product ?? pickSingleRelation(variant?.products as ProductRecord | ProductRecord[] | null | undefined)
        }
    }

    return {
        product,
        variant,
    }
}