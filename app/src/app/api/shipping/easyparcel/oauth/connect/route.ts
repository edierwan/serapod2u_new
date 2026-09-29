import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requireOutdoorStaff } from '@/lib/outdoor/staff'
import {
  easyParcelAuthUrl,
  getEasyParcelPublicOrigin,
  isEasyParcelAppConfigured,
  oauthStateCookie,
} from '@/lib/shipping/easyparcel-oauth'

/** GET — start EasyParcel OpenAPI OAuth for Outdoor staff. */
export async function GET(request: NextRequest) {
  const staff = await requireOutdoorStaff()
  if (!staff) {
    const login = new URL('/outdoor/login', getEasyParcelPublicOrigin())
    login.searchParams.set('next', '/outdoor/fulfilment')
    return NextResponse.redirect(login)
  }
  if (!isEasyParcelAppConfigured()) {
    return NextResponse.json({ error: 'EasyParcel client id/secret are not set.' }, { status: 503 })
  }

  const state = randomBytes(16).toString('hex')
  const res = NextResponse.redirect(easyParcelAuthUrl(state))
  res.headers.append('Set-Cookie', oauthStateCookie(state))
  return res
}
