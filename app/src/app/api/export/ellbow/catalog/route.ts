import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/export/ellbow/catalog
 *
 * Read-only catalog export for the Ellbow cat-food website.
 *
 * Auth: header  X-ELLBOW-SYNC-KEY  must match env  ELLBOW_SYNC_KEY
 * Query:
 *   since  – ISO-8601 timestamp; only rows updated after this date
 *   brand  – optional brand_code override (default: 'ELLBOW')
 *
 * Response:
 * {
 *   synced_at: string,
 *   products: [...],
 *   variants: [...],
 *   media: [...]
 * }
 */

export async function GET(request: NextRequest) {
    // ── Auth ────────────────────────────────────────────────────────
    const syncKey = request.headers.get('x-ellbow-sync-key')
    const expectedKey = process.env.ELLBOW_SYNC_KEY

    if (!expectedKey) {
        return NextResponse.json(
            { error: 'Server misconfiguration: ELLBOW_SYNC_KEY not set' },
            { status: 500 },
        )
    }

    if (!syncKey || syncKey !== expectedKey) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Query params ────────────────────────────────────────────────
    const { searchParams } = new URL(request.url)
    const since = searchParams.get('since') // ISO timestamp
    const brandCode = searchParams.get('brand') || 'ELLBOW'

    const supabase: any = createAdminClient()
    const syncedAt = new Date().toISOString()

    try {
        // ── 1. Find the brand row ────────────────────────────────────
        const { data: brand, error: brandErr } = await supabase
            .from('brands')
            .select('id, brand_code, brand_name')
            .ilike('brand_code', brandCode)
            .single()

        if (brandErr || !brand) {
            return NextResponse.json(
                { error: `Brand "${brandCode}" not found` },
                { status: 404 },
            )
        }

        // ── 2. Products ──────────────────────────────────────────────
        let productQuery = supabase
            .from('products')
            .select(
                'id, product_code, product_name, product_description, short_description, is_active, category_id, updated_at',
            )
            .eq('brand_id', brand.id)

        if (since) {
            productQuery = productQuery.gte('updated_at', since)
        }

        const { data: products, error: pErr } = await productQuery

        if (pErr) {
            return NextResponse.json(
                { error: 'Failed to fetch products', detail: pErr.message },
                { status: 500 },
            )
        }

        // Collect product IDs for fetching variants & media
        const allProductIds = products.map((p: any) => p.id)

        // If no products found (and not incremental), return empty
        if (allProductIds.length === 0 && !since) {
            return NextResponse.json({
                synced_at: syncedAt,
                products: [],
                variants: [],
                media: [],
            })
        }

        // For incremental sync we also need products that haven't changed
        // but whose variants/images may have changed. Fetch ALL product IDs
        // for this brand so we can query variants.
        let fullProductIds = allProductIds
        if (since && allProductIds.length === 0) {
            // Fetch all brand product IDs regardless of update time
            const { data: allProds } = await supabase
                .from('products')
                .select('id')
                .eq('brand_id', brand.id)
            fullProductIds = (allProds || []).map((p: any) => p.id)
        }

        const queryIds = fullProductIds.length > 0 ? fullProductIds : allProductIds

        // ── 3. Variants ──────────────────────────────────────────────
        let variantQuery = supabase
            .from('product_variants')
            .select(
                'id, product_id, variant_code, variant_name, barcode, manufacturer_sku, suggested_retail_price, image_url, is_active, is_default, sort_order, attributes, updated_at',
            )
            .in('product_id', queryIds.length > 0 ? queryIds : ['__none__'])

        if (since) {
            variantQuery = variantQuery.gte('updated_at', since)
        }

        const { data: variants, error: vErr } = await variantQuery

        if (vErr) {
            return NextResponse.json(
                { error: 'Failed to fetch variants', detail: vErr.message },
                { status: 500 },
            )
        }

        // ── 4. Media / images ────────────────────────────────────────
        let mediaQuery = supabase
            .from('product_images')
            .select(
                'id, product_id, variant_id, image_url, image_type, is_primary, is_active, sort_order, alt_text, title, created_at',
            )
            .in('product_id', queryIds.length > 0 ? queryIds : ['__none__'])
            .eq('is_active', true)

        // product_images may not have updated_at, filter by created_at for incremental
        if (since) {
            mediaQuery = mediaQuery.gte('created_at', since)
        }

        const { data: media, error: mErr } = await mediaQuery

        if (mErr) {
            return NextResponse.json(
                { error: 'Failed to fetch media', detail: mErr.message },
                { status: 500 },
            )
        }

        // ── 5. Shape response ────────────────────────────────────────
        return NextResponse.json({
            synced_at: syncedAt,
            brand: {
                id: brand.id,
                code: brand.brand_code,
                name: brand.brand_name,
            },
            products: (products || []).map((p: any) => ({
                id: p.id,
                slug: p.product_code?.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                code: p.product_code,
                name: p.product_name,
                description: p.product_description,
                short_description: p.short_description,
                is_active: p.is_active,
                category_id: p.category_id,
                updated_at: p.updated_at,
            })),
            variants: (variants || []).map((v: any) => ({
                id: v.id,
                product_id: v.product_id,
                sku: v.variant_code,
                name: v.variant_name,
                barcode: v.barcode,
                retail_price: v.suggested_retail_price,
                promo_price: null, // extend later from product_pricing
                image_url: v.image_url,
                is_active: v.is_active,
                is_default: v.is_default,
                sort_order: v.sort_order,
                attributes: v.attributes,
                updated_at: v.updated_at,
            })),
            media: (media || []).map((m: any) => ({
                id: m.id,
                product_id: m.product_id,
                variant_id: m.variant_id,
                url: m.image_url,
                type: m.image_type,
                is_primary: m.is_primary,
                sort_order: m.sort_order,
                alt_text: m.alt_text,
                title: m.title,
                created_at: m.created_at,
            })),
        })
    } catch (err: any) {
        console.error('[ellbow/catalog] Unexpected error:', err)
        return NextResponse.json(
            { error: 'Internal server error', detail: err?.message },
            { status: 500 },
        )
    }
}
