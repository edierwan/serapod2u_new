import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOutdoorStaff } from '@/lib/outdoor/staff'
import { resolveOutdoorCatalogScope } from '@/lib/outdoor/catalog'
import { countOutdoorSubscribers } from '@/lib/outdoor/notify-subscribers'
import { outdoorNavKey, outdoorStaticImage } from '@/lib/outdoor/merch'

const MASTER_ONLY = 'Products are managed in the main admin. Outdoor shows those products.'

const PRODUCT_SELECT = `
  id,
  product_name,
  product_description,
  category_id,
  brand_id,
  product_variants (
    id,
    variant_name,
    suggested_retail_price,
    is_default,
    sort_order,
    is_active,
    image_url,
    attributes
  )
`

function pickVariant(variants: any[] | null | undefined) {
  const rows = variants || []
  return rows.find((row) => row.is_default) || [...rows].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))[0] || null
}

function colorOf(variant: any) {
  const name = String(variant?.variant_name || '').trim()
  if (name && name.toLowerCase() !== 'default') return name
  const fromAttributes = variant?.attributes && typeof variant.attributes === 'object' ? String(variant.attributes.color || '').trim() : ''
  return fromAttributes
}

function savedImage(variant: any) {
  return String(variant?.image_url || '').trim()
}

function previewImage(name: string, variant: any) {
  return savedImage(variant) || outdoorStaticImage(name, colorOf(variant) || '#76232F') || ''
}

function variantPrice(variant: any) {
  return Number(variant?.suggested_retail_price || 0)
}

function toEditorProduct(row: any) {
  const visible = (row.product_variants || []).filter((variant: any) => variant?.is_active !== false && !variant?.attributes?.outdoor_only_variant)
  const variant = pickVariant(visible)
  const prices = visible.map(variantPrice).filter((price: number) => price > 0)
  return {
    id: row.id,
    name: row.product_name || '',
    description: row.product_description || '',
    price: prices.length > 0 ? Math.min(...prices) : variantPrice(variant),
    color: colorOf(variant),
    imageUrl: previewImage(row.product_name || '', variant),
    nav: outdoorNavKey(String(variant?.attributes?.outdoor_nav || ''), row.product_name || ''),
    colors: visible.map((item: any) => ({
      id: item.id,
      name: colorOf(item),
      price: variantPrice(item),
    })),
  }
}

async function loadOutdoorProducts(admin: any, scope: { categoryIds: string[]; brandId: string | null }) {
  const select = `${PRODUCT_SELECT}, outdoor_only`
  const build = (columns: string) => {
    const queries = []
    if (scope.categoryIds.length > 0) {
      queries.push(admin.from('products').select(columns).in('category_id', scope.categoryIds).eq('is_active', true).order('product_name').limit(80))
    }
    if (scope.brandId) {
      queries.push(admin.from('products').select(columns).eq('brand_id', scope.brandId).eq('is_active', true).order('product_name').limit(80))
    }
    return queries
  }

  let results = await Promise.all(build(select))
  if (results.some((result) => result.error && /outdoor_only/i.test(result.error.message || ''))) {
    results = await Promise.all(build(PRODUCT_SELECT))
  }

  const byId = new Map<string, any>()
  let sawRows = false
  let lastError: { message?: string } | null = null
  for (const result of results) {
    if (result.error) {
      lastError = result.error
      continue
    }
    sawRows = true
    for (const row of result.data || []) {
      if (row.outdoor_only) continue
      byId.set(row.id, row)
    }
  }
  if (!sawRows && lastError) throw lastError
  return [...byId.values()].map(toEditorProduct)
}

/** GET — master products Outdoor is showing. Staff do not edit them here. */
export async function GET() {
  try {
    const staff = await requireOutdoorStaff()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin: any = createAdminClient()
    const scope = await resolveOutdoorCatalogScope()
    const [subscribers, loaded] = await Promise.all([
      countOutdoorSubscribers(admin),
      loadOutdoorProducts(admin, scope),
    ])
    return NextResponse.json({ products: loaded, subscribers })
  } catch (err) {
    console.error('[outdoor/products GET]', err)
    return NextResponse.json({ error: 'Could not load products.' }, { status: 500 })
  }
}

export async function POST() {
  return NextResponse.json({ error: MASTER_ONLY }, { status: 400 })
}

export async function PATCH() {
  return NextResponse.json({ error: MASTER_ONLY }, { status: 400 })
}

export async function DELETE() {
  return NextResponse.json({ error: MASTER_ONLY }, { status: 400 })
}
