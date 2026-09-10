import { NextRequest, NextResponse } from 'next/server'
import { easyParcelRateCheck, isEasyParcelConfigured } from '@/lib/shipping/easyparcel'
import { toEasyParcelState } from '@/lib/shipping/malaysia-states'

/** POST /api/shipping/easyparcel/rates — quote courier rates (server-side key only). */
export async function POST(request: NextRequest) {
  try {
    if (!isEasyParcelConfigured()) {
      return NextResponse.json({
        configured: false,
        rates: [],
        message: 'Shipping rates are not set up yet.',
      })
    }

    const body = await request.json().catch(() => ({}))
    const postcode = String(body.postcode || '').trim()
    const state = toEasyParcelState(String(body.state || ''))
    const weightKg = body.weightKg != null ? Number(body.weightKg) : undefined

    if (!postcode || !state) {
      return NextResponse.json({ error: 'Postcode and state are required' }, { status: 400 })
    }

    const result = await easyParcelRateCheck({
      sendCode: postcode,
      sendState: state,
      sendCountry: 'MY',
      weightKg: Number.isFinite(weightKg) ? weightKg : undefined,
    })

    if (!result.ok) {
      return NextResponse.json({ configured: true, rates: [], error: result.error }, { status: 502 })
    }

    return NextResponse.json({ configured: true, rates: result.rates })
  } catch (err) {
    console.error('[easyparcel/rates]', err)
    return NextResponse.json({ error: 'Could not fetch shipping rates' }, { status: 500 })
  }
}
