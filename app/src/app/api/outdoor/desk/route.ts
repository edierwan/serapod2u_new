import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireOutdoorStaff } from '@/lib/outdoor/staff'
import { loadOutdoorDesk } from '@/lib/outdoor/desk-server'

export const dynamic = 'force-dynamic'

/** GET — what the Outdoor desk needs: work waiting, this month's sales, and product status. */
export async function GET() {
  try {
    const staff = await requireOutdoorStaff()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json(await loadOutdoorDesk(createAdminClient()))
  } catch (err) {
    console.error('[outdoor/desk GET]', err)
    return NextResponse.json({ error: 'Could not load the desk.' }, { status: 500 })
  }
}
