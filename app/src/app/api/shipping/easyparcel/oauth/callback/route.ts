import { NextRequest, NextResponse } from 'next/server'
import { requireOutdoorStaff } from '@/lib/outdoor/staff'
import {
  clearOauthStateCookie,
  getEasyParcelPublicOrigin,
  readOauthStateCookie,
  saveEasyParcelAuthorizationCode,
} from '@/lib/shipping/easyparcel-oauth'

function fulfilmentRedirect(request: NextRequest, query: string) {
  const url = new URL('/outdoor/fulfilment', getEasyParcelPublicOrigin())
  url.searchParams.set('easyparcel', query)
  const res = NextResponse.redirect(url)
  res.headers.append('Set-Cookie', clearOauthStateCookie())
  return res
}

/** GET — EasyParcel OAuth callback. */
export async function GET(request: NextRequest) {
  const staff = await requireOutdoorStaff()
  if (!staff) {
    return fulfilmentRedirect(request, 'unauthorized')
  }

  const code = String(request.nextUrl.searchParams.get('code') || '').trim()
  const state = String(request.nextUrl.searchParams.get('state') || '').trim()
  const expected = readOauthStateCookie(request.headers.get('cookie'))
  if (!code || !state || !expected || state !== expected) {
    return fulfilmentRedirect(request, 'invalid')
  }

  const saved = await saveEasyParcelAuthorizationCode(code)
  if (!saved.ok) {
    console.error('[easyparcel/oauth]', saved.error)
    return fulfilmentRedirect(request, 'error')
  }
  return fulfilmentRedirect(request, 'connected')
}
