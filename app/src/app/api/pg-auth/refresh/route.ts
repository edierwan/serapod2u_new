/**
 * PG Auth Refresh API Route
 * POST /api/pg-auth/refresh
 */

import { NextRequest, NextResponse } from 'next/server'
import { refreshSession, AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME_EXPORT, getAuthCookieOptions, getRefreshCookieOptions } from '@/lib/db/pg-auth'

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get(REFRESH_COOKIE_NAME_EXPORT)?.value
    if (!refreshToken) {
      return NextResponse.json(
        { data: { session: null }, error: { message: 'No refresh token' } },
        { status: 401 }
      )
    }

    const result = await refreshSession(refreshToken)
    if (result.error) {
      const response = NextResponse.json(result, { status: 401 })
      response.cookies.delete(AUTH_COOKIE_NAME)
      response.cookies.delete(REFRESH_COOKIE_NAME_EXPORT)
      return response
    }

    const secure = process.env.NODE_ENV === 'production'
    const response = NextResponse.json(result)
    response.cookies.set(AUTH_COOKIE_NAME, result.data.session.access_token, getAuthCookieOptions(secure))
    response.cookies.set(REFRESH_COOKIE_NAME_EXPORT, result.data.session.refresh_token, getRefreshCookieOptions(secure))

    return response
  } catch (err: any) {
    return NextResponse.json(
      { data: { session: null }, error: { message: err.message } },
      { status: 500 }
    )
  }
}
