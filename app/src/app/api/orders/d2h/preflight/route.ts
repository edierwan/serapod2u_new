import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveQuickOrderCatalog, validateQuickOrderCatalogItems } from '@/lib/orders/quick-order-catalog'

interface RequestedItem {
  variantId: string
  quantity: number
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const mode = body?.mode === 'standard' ? 'standard' : 'quick'
    const items = Array.isArray(body?.items) ? body.items as RequestedItem[] : []
    if (items.length === 0 || items.some(item =>
      typeof item?.variantId !== 'string'
      || !Number.isSafeInteger(item?.quantity)
      || item.quantity <= 0
    )) {
      return NextResponse.json({ error: 'Every order item requires a variant and a positive whole-number quantity.' }, { status: 400 })
    }

    const variantIds = items.map(item => item.variantId)
    if (new Set(variantIds).size !== variantIds.length) {
      return NextResponse.json({ error: 'Duplicate variants must be combined before creating the order.' }, { status: 400 })
    }

    const { data: requester, error: requesterError } = await supabase
      .from('users')
      .select('organization_id')
      .eq('id', user.id)
      .single()
    if (requesterError) {
      console.error('D2H preflight requester lookup failed:', requesterError)
      return NextResponse.json({ error: 'Unable to verify your organization.' }, { status: 500 })
    }
    if (!requester?.organization_id) return NextResponse.json({ error: 'User organization not found.' }, { status: 403 })

    const { data: requesterOrganization, error: requesterOrganizationError } = await supabase
      .from('organizations')
      .select('org_type_code')
      .eq('id', requester.organization_id)
      .single()
    if (requesterOrganizationError || !requesterOrganization) {
      console.error('D2H preflight organization lookup failed:', requesterOrganizationError)
      return NextResponse.json({ error: 'Unable to verify your organization.' }, { status: 500 })
    }

    if (mode === 'quick') {
      if (typeof body?.distributorId !== 'string' || !body.distributorId) {
        return NextResponse.json({ error: 'A distributor is required.' }, { status: 400 })
      }

      const catalog = await resolveQuickOrderCatalog(supabase, body.distributorId, requester.organization_id)
      try {
        const validated = validateQuickOrderCatalogItems(items, catalog.variants)
        return NextResponse.json({ items: validated })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to validate the Quick Order catalog.'
        return NextResponse.json(
          { error: message },
          { status: 409 },
        )
      }
    }

    if (!['HQ', 'WH'].includes(requesterOrganization?.org_type_code || '')) {
      return NextResponse.json({ error: 'Your organization is not authorized to create this D2H order.' }, { status: 403 })
    }

    let inventoryOrganizationId = requester.organization_id
    if (requesterOrganization?.org_type_code === 'HQ') {
      const { data: warehouse } = await supabase
        .from('organizations')
        .select('id')
        .eq('parent_org_id', requester.organization_id)
        .eq('org_type_code', 'WH')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (warehouse) inventoryOrganizationId = warehouse.id
    }

    const [{ data: variants, error: variantsError }, { data: inventory, error: inventoryError }] = await Promise.all([
      supabase
        .from('product_variants')
        .select('id, distributor_price, is_active, products!inner(is_active)')
        .in('id', variantIds)
        .eq('is_active', true)
        .eq('products.is_active', true),
      supabase
        .from('product_inventory')
        .select('variant_id, quantity_available')
        .eq('organization_id', inventoryOrganizationId)
        .in('variant_id', variantIds),
    ])

    if (variantsError || inventoryError) {
      console.error('D2H preflight query failed:', variantsError || inventoryError)
      return NextResponse.json({ error: 'Unable to validate current stock and prices.' }, { status: 500 })
    }
    if ((variants || []).length !== variantIds.length) {
      return NextResponse.json({ error: 'One or more variants are inactive, unauthorized, or no longer available.' }, { status: 409 })
    }

    const variantsById = new Map((variants || []).map(variant => [variant.id, variant]))
    const stockByVariant = new Map((inventory || []).map(stock => [stock.variant_id, Number(stock.quantity_available || 0)]))
    const validated = items.map(item => {
      const variant = variantsById.get(item.variantId)!
      return {
        variantId: item.variantId,
        quantity: item.quantity,
        availableQuantity: stockByVariant.get(item.variantId) || 0,
        distributorPrice: Number(variant.distributor_price || 0),
      }
    })
    const priceMissing = validated.find(item => item.distributorPrice <= 0)
    if (priceMissing) return NextResponse.json({ error: 'Distributor price is not maintained for one or more selected variants.' }, { status: 409 })
    const insufficient = validated.find(item => item.quantity > item.availableQuantity)
    if (insufficient) {
      return NextResponse.json({ error: `Insufficient stock: ${insufficient.availableQuantity} units are currently available for a selected variant.` }, { status: 409 })
    }

    return NextResponse.json({ items: validated })
  } catch (error) {
    console.error('D2H preflight failed:', error)
    return NextResponse.json({ error: 'Unable to validate the D2H order.' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
