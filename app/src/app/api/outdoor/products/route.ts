import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOutdoorStaff } from '@/lib/outdoor/staff'
import { listOutdoorProducts } from '@/lib/outdoor/catalog'
import { countOutdoorSubscribers } from '@/lib/outdoor/notify-subscribers'

const MASTER_ONLY = 'Products are managed in the main admin. Outdoor shows those products.'

async function loadShopProducts() {
  const { products } = await listOutdoorProducts({ sort: 'name_asc', limit: 48 })
  return products
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
