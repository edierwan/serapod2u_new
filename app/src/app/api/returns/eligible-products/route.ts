import { NextRequest, NextResponse } from 'next/server'
import { getReturnContext } from '@/lib/returns/server'
import { resolveEligibleProducts } from '@/lib/returns/eligibility'

/**
 * GET /api/returns/eligible-products?shop=<orgId>&category=<categoryId?>
 *
 * Resolves the shop's program → mapped category → all active products for the
 * worksheet. Pass `category` to override with a manually selected category when
 * the program/category can't be auto-resolved.
 */
export async function GET(request: NextRequest) {
    const ctx = await getReturnContext()
    if (ctx instanceof NextResponse) return ctx

    const sp = request.nextUrl.searchParams
    // Source org (Shop or Distributor). Self-service users are scoped to own org.
    // `source` is the current param; `shop` is accepted for backward compatibility.
    const shopId = ctx.isManager ? (sp.get('source') || sp.get('shop')) : ctx.orgId
    const categoryId = sp.get('category')

    if (!shopId) {
        return NextResponse.json({ error: 'A return source organization is required' }, { status: 400 })
    }
    // A self-service user may only load their own org's products.
    if (!ctx.isManager && shopId !== ctx.orgId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    try {
        const result = await resolveEligibleProducts(ctx.admin, shopId, categoryId)
        return NextResponse.json(result)
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || 'Failed to load eligible products' }, { status: 500 })
    }
}
