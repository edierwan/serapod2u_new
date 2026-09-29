import { NextResponse } from 'next/server'
import { requireOutdoorStaff } from '@/lib/outdoor/staff'

/** GET — whether current user may open Outdoor fulfilment desk. */
export async function GET() {
  try {
    const staff = await requireOutdoorStaff()
    return NextResponse.json({ allowed: Boolean(staff) })
  } catch {
    return NextResponse.json({ allowed: false })
  }
}
