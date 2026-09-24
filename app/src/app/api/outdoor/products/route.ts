import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOutdoorStaff } from '@/lib/outdoor/staff'
import { resolveOutdoorCatalogScope } from '@/lib/outdoor/catalog'
import { countOutdoorSubscribers } from '@/lib/outdoor/notify-subscribers'
import { listProducts, type StorefrontProduct } from '@/lib/storefront/products'

const MASTER_ONLY = 'Products are managed in the main admin. Outdoor shows those products.'

async function loadShopProducts() {
  const scope = await resolveOutdoorCatalogScope()
  if (scope.matchedBy === 'none') return [] as StorefrontProduct[]

  if (scope.categoryIds.length > 1) {
    const pages = await Promise.all(
      scope.categoryIds.map((id) => listProducts({ category: id, sort: 'name_asc', page: 1, limit: 48 })),
    )
    const map = new Map<string, StorefrontProduct>()
    for (const page of pages) {
      for (const product of page.products) map.set(product.id, product)
    }
    return [...map.values()]
  }

  const result = await listProducts({
    category: scope.categoryIds[0],
    brandId: scope.categoryIds.length === 0 ? scope.brandId || undefined : undefined,
    sort: 'name_asc',
    page: 1,
    limit: 48,
  })
  return result.products
}

/** GET — the same Outdoor products the main shop lists, for staff to view. */
export async function GET() {
  try {
    const staff = await requireOutdoorStaff()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin: any = createAdminClient()
    const [subscribers, products] = await Promise.all([
      countOutdoorSubscribers(admin),
      loadShopProducts(),
    ])
    return NextResponse.json({ products, subscribers })
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
